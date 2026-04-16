import path from 'path';
import { prisma } from '../lib/prisma';
import { extractDxfViewports, renderDxf } from './dxf.service';
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

    const viewportData = await extractDxfViewports(analysis.project.dxfFile.storedPath);

    // Best-effort: render preview images. Failure here doesn't block analysis.
    const renderRoot = path.resolve(__dirname, '../../uploads/renders', analysis.project.dxfFile.id);
    let renderedImages: string[] = [];
    try {
      renderedImages = await renderDxf(analysis.project.dxfFile.storedPath, renderRoot);
      console.log(`[dxf-render] generated ${renderedImages.length} previews for ${analysis.project.dxfFile.id}`);
    } catch (e) {
      console.error('[dxf-render] failed:', e);
    }

    await prisma.dxfFile.update({
      where: { id: analysis.project.dxfFile.id },
      data: {
        viewportMap: viewportData.viewport_classifications as object,
        extractedData: viewportData as unknown as object,
        renderedImages: renderedImages as unknown as object,
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
