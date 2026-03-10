export class AppError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function assert(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) {
    throw new AppError(status, code, message);
  }
}


