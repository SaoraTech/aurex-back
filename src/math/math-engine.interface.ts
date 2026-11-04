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
  timeoutMs?: number;
}

export type MathExecutionStatus = 'verified' | 'unsupported' | 'failed';

export interface MathResult {
  engine: 'sagemath';
  status: MathExecutionStatus;
  latex?: string;
  plainText?: string;
  steps?: string[];
  computationTimeMs: number;
  error?: string;
}

export interface MathEngine {
  readonly engineName: 'sagemath';
  isAvailable(): boolean;
  execute(input: MathOperationInput): Promise<MathResult>;
}
