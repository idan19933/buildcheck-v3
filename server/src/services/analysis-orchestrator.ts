import path from 'path';
import { prisma } from '../lib/prisma';
import { extractDxfViewports, renderDxfPreviews } from './dxf.service';
import { processDxf } from './dxf-pipeline.service';
import { extractPdfText, parseTavaRequirements, TavaRequirement } from './pdf-extract.service';
import { runCoreComplianceAgent } from './core-compliance-agent';
import { FireAddonAgent } from './addon-agents/fire-agent';
import { WaterAddonAgent } from './addon-agents/water-agent';
import { ElectricityAddonAgent } from './addon-agents/electricity-agent';
import { AccessibilityAddonAgent } from './addon-agents/accessibility-agent';
import type { BaseAddonAgent } from './addon-agents/base-addon-agent';
import type { AddonDomain } from '@prisma/client';

export async function runCoreAnalysis(analysisId: string): Promise<void> {
  try {
    await prisma.analysis.update({
      where: { id: analysisId },
      data: { status: 'EXTRACTING_DXF', startedAt: new Date() },
    });

    const analysis = await prisma.analysis.findUnique({
      where: { id: analysisId },
      include: { project: { include: { dxfFile: true, tavaFile: true } } },
    });

    if (!analysis?.project.dxfFile || !analysis?.project.tavaFile) {
      throw new Error('Missing DXF or תב"ע file');
    }

    // Run the AI-codegen pipeline (Phase 1 explore → Phase 2 generate → Phase 3 extract)
    // and the legacy static viewport extractor in parallel. The new pipeline owns SVG
    // rendering + structured compliance_data; the legacy extractor still feeds the
    // compliance agent's existing viewports[] shape until that agent is migrated.
    const dxfPath = analysis.project.dxfFile.storedPath;
    const dxfFileId = analysis.project.dxfFile.id;
    const renderRoot = path.resolve(__dirname, '../../uploads/renders', dxfFileId);

    // Fast-path callback: as soon as Phase 1 explore lands, render deterministic
    // PNG previews (~8 s) and write a partial DB update. The frontend's polling
    // picks them up and shows thumbnails while Phase 2/3 finish (~90 s more).
    const onExplorationReady = async (_exp: unknown, explorationJsonPath: string) => {
      try {
        const t0 = Date.now();
        const preview = await renderDxfPreviews(dxfPath, explorationJsonPath, renderRoot);
        console.log(
          `[preview:${dxfFileId.slice(0, 8)}] ${preview.preview_count} PNGs in ${Date.now() - t0}ms`,
        );
        // Read whatever's already in renderedImages so we don't clobber a
        // fully-finished AI run that raced us (unlikely — preview is much faster).
        const existing = await prisma.dxfFile.findUnique({
          where: { id: dxfFileId },
          select: { renderedImages: true },
        });
        const current = (existing?.renderedImages as Record<string, unknown> | null) ?? {};
        await prisma.dxfFile.update({
          where: { id: dxfFileId },
          data: {
            renderedImages: {
              ...current,
              previews: preview.previews,
              preview_ready_at: new Date().toISOString(),
            } as object,
          },
        });
      } catch (e) {
        console.error(`[preview:${dxfFileId.slice(0, 8)}] failed:`, e);
      }
    };

    const [viewportData, pipelineSettled] = await Promise.all([
      extractDxfViewports(dxfPath),
      processDxf(dxfPath, renderRoot, {
        onProgress: (step, detail) =>
          console.log(`[pipeline:${dxfFileId.slice(0, 8)}] ${step} — ${detail}`),
        onExplorationReady,
      }).then(
        (r) => ({ ok: true as const, value: r }),
        (e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }),
      ),
    ]);

    let renderedSheets: object | undefined;
    if (pipelineSettled.ok) {
      const r = pipelineSettled.value;
      const cd = r.complianceData as Record<string, unknown> | undefined;
      const aiSheets = (cd?.sheets as Array<Record<string, unknown>> | undefined) ?? [];
      // Pull in whatever the preview callback already wrote so we don't
      // overwrite the previews / preview_ready_at fields.
      const existing = await prisma.dxfFile.findUnique({
        where: { id: dxfFileId },
        select: { renderedImages: true },
      });
      const previewState = (existing?.renderedImages as Record<string, unknown> | null) ?? {};
      // Transform the AI pipeline's sheet shape into the RenderedSheets shape the
      // frontend (DxfPreview / types/index.ts) already consumes.
      renderedSheets = {
        previews: previewState.previews ?? [],
        preview_ready_at: previewState.preview_ready_at ?? null,
        sheets: aiSheets.map((s) => ({
          sheet_num: (s.sheet_number as number | undefined) ?? 0,
          filename: s.svg_file as string,
          label_he: (s.name as string | undefined) ?? '',
          label_en: (s.name_en as string | undefined) ?? '',
          type: (s.type as string | undefined) ?? 'unclassified',
          icon: '',
          scale: (s.scale as string | null | undefined) ?? null,
          geo_viewport: (s.geometry_source as string | null | undefined) ?? null,
          ann_viewport: (s.annotation_source as string | null | undefined) ?? null,
          pair_score: 0,
          entity_count: (s.entity_count as number | undefined) ?? 0,
          bbox: (s.bbox as [number, number, number, number] | undefined) ?? [0, 0, 0, 0],
        })),
        files: aiSheets.map((s) => s.svg_file as string),
        viewport_count: Object.keys((r.exploration as { blocks?: object }).blocks ?? {}).length,
        sheet_count: aiSheets.length,
        ai_pipeline: {
          used_fallback: r.usedFallback,
          generated_script: r.generatedScriptPath,
          rendering_warnings: (cd?.rendering_warnings as string[] | undefined) ?? [],
          compliance_data: cd?.compliance_data ?? null,
        },
      };
      console.log(
        `[pipeline:${dxfFileId.slice(0, 8)}] done — ${aiSheets.length} sheets, ` +
        `fallback=${r.usedFallback}, warnings=${(cd?.rendering_warnings as string[] | undefined)?.length ?? 0}`,
      );
    } else {
      console.error(`[pipeline:${dxfFileId.slice(0, 8)}] failed: ${pipelineSettled.error}`);
    }

    await prisma.dxfFile.update({
      where: { id: dxfFileId },
      data: {
        viewportMap: viewportData.viewport_classifications as object,
        extractedData: viewportData as unknown as object,
        ...(renderedSheets ? { renderedImages: renderedSheets } : {}),
      },
    });

    await prisma.analysis.update({
      where: { id: analysisId },
      data: { status: 'EXTRACTING_TAVA' },
    });

    let tavaText = analysis.project.tavaFile.extractedText;
    if (!tavaText) {
      const extraction = await extractPdfText(analysis.project.tavaFile.storedPath);
      tavaText = extraction.text;
      await prisma.tavaFile.update({
        where: { id: analysis.project.tavaFile.id },
        data: { extractedText: tavaText, extractionMethod: extraction.method },
      });
    }

    let requirements = analysis.project.tavaFile.requirements as TavaRequirement[] | null;
    if (!requirements) {
      requirements = await parseTavaRequirements(tavaText);
      await prisma.tavaFile.update({
        where: { id: analysis.project.tavaFile.id },
        data: { requirements: requirements as unknown as object },
      });
    }

    await prisma.analysis.update({
      where: { id: analysisId },
      data: { status: 'ANALYZING' },
    });

    const result = await runCoreComplianceAgent(viewportData, requirements, tavaText);

    await prisma.analysis.update({
      where: { id: analysisId },
      data: {
        status: 'COMPLETED',
        overallScore: result.score,
        passCount: result.passCount,
        failCount: result.failCount,
        warningCount: result.warningCount,
        cannotCheckCount: result.cannotCheckCount,
        coreResults: result.requirements as unknown as object,
        summary: result.summary,
        completedAt: new Date(),
      },
    });

    await prisma.project.update({
      where: { id: analysis.projectId },
      data: { status: 'COMPLETED' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Analysis ${analysisId} failed:`, err);
    await prisma.analysis.update({
      where: { id: analysisId },
      data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
    });
  }
}

function getAgent(domain: AddonDomain): BaseAddonAgent {
  switch (domain) {
    case 'FIRE': return new FireAddonAgent();
    case 'WATER': return new WaterAddonAgent();
    case 'ELECTRICITY': return new ElectricityAddonAgent();
    case 'ACCESSIBILITY': return new AccessibilityAddonAgent();
  }
}

export async function runAddonAgent(
  analysisId: string,
  domain: AddonDomain,
  documentId: string,
): Promise<void> {
  const addonRun = await prisma.addonRun.upsert({
    where: { analysisId_domain: { analysisId, domain } },
    create: {
      analysisId, domain, documentId,
      status: 'RUNNING', startedAt: new Date(),
    },
    update: {
      documentId, status: 'RUNNING',
      startedAt: new Date(), errorMessage: null, completedAt: null,
    },
  });

  try {
    const analysis = await prisma.analysis.findUnique({
      where: { id: analysisId },
      include: { project: { include: { dxfFile: true, tavaFile: true } } },
    });
    const document = await prisma.addonDocument.findUnique({ where: { id: documentId } });

    if (!analysis?.project.dxfFile?.extractedData || !document?.extractedText) {
      throw new Error('Missing DXF viewport data or addon document text');
    }

    const agent = getAgent(domain);
    const result = await agent.analyze(
      analysis.project.dxfFile.extractedData as never,
      document.extractedText,
      analysis.project.tavaFile?.extractedText || '',
    );

    await prisma.addonRun.update({
      where: { id: addonRun.id },
      data: {
        status: 'COMPLETED',
        score: result.score,
        passCount: result.passCount,
        failCount: result.failCount,
        warningCount: result.warningCount,
        cannotCheckCount: result.cannotCheckCount,
        results: result.requirements as unknown as object,
        summary: result.summary,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await prisma.addonRun.update({
      where: { id: addonRun.id },
      data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
    });
  }
}
