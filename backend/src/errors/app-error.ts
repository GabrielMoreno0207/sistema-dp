/**
 * Erro de negócio com status HTTP. Lance em services/controllers;
 * o error handler central converte em resposta JSON.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'BAD_REQUEST',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso não encontrado') {
    super(message, 404, 'NOT_FOUND');
  }
}
