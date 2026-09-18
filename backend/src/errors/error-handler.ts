import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './app-error';

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({ error: error.code, message: error.message });
    return;
  }

  // Erro de validação do JSON Schema do Fastify
  if (error.validation) {
    reply.status(400).send({ error: 'VALIDATION_ERROR', message: error.message });
    return;
  }

  // Corpo com acentos fora de UTF-8 (ex.: PowerShell 5.1 sem charset) chega com tamanho divergente
  if (error.code === 'FST_ERR_CTP_INVALID_CONTENT_LENGTH' || error.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
    reply.status(400).send({
      error: 'INVALID_BODY',
      message: 'Corpo da requisição inválido. Envie JSON válido codificado em UTF-8.',
    });
    return;
  }

  // Valor único repetido no banco (ex.: dois cadastros iguais ao mesmo tempo): conflito, não erro interno
  if (/UNIQUE constraint failed/i.test(error.message)) {
    reply.status(409).send({ error: 'CONFLICT', message: 'Já existe um registro com esses dados.' });
    return;
  }

  const statusCode = error.statusCode ?? 500;
  if (statusCode < 500) {
    reply.status(statusCode).send({ error: error.code ?? 'BAD_REQUEST', message: error.message });
    return;
  }

  request.log.error({ err: error }, 'Erro interno não tratado');
  reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Erro interno do servidor' });
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): void {
  reply.status(404).send({ error: 'NOT_FOUND', message: `Rota ${request.method} ${request.url} não encontrada` });
}
