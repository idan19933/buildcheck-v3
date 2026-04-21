export interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'MEMBER';
  companyId: string;
}

export interface SheetRender {
  sheet_num: number;
  filename: string;
  label_he: string;
  label_en: string;
  type:
    | 'floor_plan' | 'roof_plan' | 'cross_section' | 'elevation'
    | 'site_plan' | 'survey' | 'parking_section' | 'index_page' | 'unclassified';
  icon: string;
  scale: string | null;
  geo_viewport: string | null;
  ann_viewport: string | null;
  pair_score: number;
  entity_count: number;
  bbox: [number, number, number, number];
}

export interface PreviewSheet {
  index: number;
  filename: string;
  geometry_vp?: string | null;
  annotation_vp?: string | null;
  block?: string;
  source?: string;
  line_count: number;
}

export interface RenderedSheets {
  sheets: SheetRender[];
  files: string[];
  viewport_count: number;
  sheet_count: number;
  /** Deterministic PNG previews — appear ~10 s after upload, before AI sheets. */
  previews?: PreviewSheet[];
  preview_ready_at?: string | null;
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  locality?: string | null;
  status: 'DRAFT' | 'READY' | 'ANALYZING' | 'COMPLETED';
  createdAt: string;
  dxfFile?: { id: string; originalName: string; renderedImages?: RenderedSheets | string[] | null } | null;
  tavaFile?: { id: string; originalName: string } | null;
  createdBy?: { id: string; name: string; email: string };
  _count?: { analyses: number };
}

export type ComplianceStatus = 'PASS' | 'FAIL' | 'WARNING' | 'CANNOT_CHECK';

export interface ComplianceResult {
  requirement: string;
  source: string;
  status: ComplianceStatus;
  details: string;
  dxfEvidence: string;
  measuredValue: string | number | null;
  requiredValue: string | number | null;
  category: string;
}

export type AnalysisStatus =
  | 'PENDING' | 'EXTRACTING_DXF' | 'EXTRACTING_TAVA'
  | 'ANALYZING' | 'COMPLETED' | 'FAILED';

export interface Analysis {
  id: string;
  projectId: string;
  status: AnalysisStatus;
  overallScore: number | null;
  passCount: number | null;
  failCount: number | null;
  warningCount: number | null;
  cannotCheckCount: number | null;
  coreResults: ComplianceResult[] | null;
  summary: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  project?: Project;
}

export type AddonDomain = 'FIRE' | 'WATER' | 'ELECTRICITY' | 'ACCESSIBILITY';

export interface AddonInfo {
  domain: AddonDomain;
  displayName: string;
  hasDocument: boolean;
  documentName: string | null;
  documentId: string | null;
  run: {
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    score: number | null;
    passCount: number | null;
    failCount: number | null;
    warningCount: number | null;
    cannotCheckCount: number | null;
    summary: string | null;
    results: ComplianceResult[] | null;
    errorMessage: string | null;
    completedAt: string | null;
  } | null;
}
