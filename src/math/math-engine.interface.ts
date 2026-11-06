export type MathOperationType =
  | 'derivative'
  | 'integral'
  | 'simplify'
  | 'factor'
  | 'solve'
  | 'limit'
  | 'matrix_determinant'
  | 'custom';

export interface MathOperationInput {
  operation: MathOperationType;
  expression: string;
  variable?: string;
  bounds?: { lower?: string; upper?: string };
  parameters?: Record<string, unknown>;
  timeoutMs?: number;
}

export type MathExecutionStatus = 'verified' | 'unsupported' | 'failed';

export type MathErrorCode =
  | 'NOT_CONFIGURED'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_OPERATION'
  | 'COMPUTATION_ERROR'
  | 'SECURITY_REJECTED';

export interface MathResult {
  engine: 'smp';
  status: MathExecutionStatus;
  latex?: string;
  plainText?: string;
  steps?: string[];
  computationTimeMs: number;
  errorCode?: MathErrorCode;
  error?: string;
}

export interface MathEngine {
  readonly engineName: 'smp';
  isAvailable(): boolean;
  execute(input: MathOperationInput): Promise<MathResult>;
}
