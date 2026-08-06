export interface OptimizationStepLog {
  step: number;
  passName: string;
  colorDpi: number;
  monoDpi: number;
  outputSize: number;
  timeMs: number;
  achievedTarget: boolean;
}

export interface DetailedOptimizationReport {
  originalSize: number;
  finalSize: number;
  compressionRatioPct: number;
  docType: "digital" | "scanned";
  imagesOptimized: number;
  fontsPreserved: number;
  objectsRemoved: number;
  processingTimeMs: number;
  profileUsed: string;
  isAlreadyOptimized: boolean;
  qualityValidated: boolean;
}

export interface OptimizationResult {
  optimizedBuffer: Buffer;
  engineUsed: string;
  originalSize: number;
  optimizedSize: number;
  targetSizeMB: number;
  docType: "digital" | "scanned";
  profileUsed: string;
  processingTimeMs: number;
  compressionRatioPct: number;
  stepsCount: number;
  stepsLog?: OptimizationStepLog[];
  report?: DetailedOptimizationReport;
}

export interface OptimizationOptions {
  fileName?: string;
  profile?: string;
  targetSizeMB?: number;
  fastMode?: boolean;
}

export interface IPdfOptimizer {
  name: string;
  isAvailable(): Promise<boolean>;
  optimize(inputBuffer: Buffer, options?: OptimizationOptions): Promise<OptimizationResult>;
}

export interface ConversionResult {
  pdfBuffer: Buffer;
  loTimeMs: number;
  isCacheHit: boolean;
}
