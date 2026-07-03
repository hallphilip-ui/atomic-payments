import { PrismaClient } from '@prisma/client';
import { OperatorRole } from './operatorRules';

const prisma = new PrismaClient();

export type OperatorAuditInput = {
  action: string;
  subjectType: string;
  subjectId?: string;
  operatorRole?: OperatorRole | 'system';
  requestId?: string;
  method: string;
  path: string;
  outcome: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

type StoredOperatorAuditLog = {
  id: string;
  action: string;
  subjectType: string;
  subjectId: string | null;
  operatorRole: string;
  requestId: string | null;
  method: string;
  path: string;
  outcome: string;
  metadata: string;
  createdAt: Date;
};

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toAuditLogView(entry: StoredOperatorAuditLog) {
  return {
    id: entry.id,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    operatorRole: entry.operatorRole,
    requestId: entry.requestId,
    method: entry.method,
    path: entry.path,
    outcome: entry.outcome,
    metadata: parseMetadata(entry.metadata),
    createdAt: entry.createdAt.toISOString()
  };
}

export async function recordOperatorAudit(input: OperatorAuditInput) {
  const entry = await prisma.operatorAuditLog.create({
    data: {
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      operatorRole: input.operatorRole || 'system',
      requestId: input.requestId,
      method: input.method,
      path: input.path,
      outcome: input.outcome,
      metadata: JSON.stringify(input.metadata || {})
    }
  });

  return toAuditLogView(entry);
}

export async function listOperatorAuditLogs(limit = 100) {
  const entries = await prisma.operatorAuditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(limit, 250))
  });

  return entries.map(toAuditLogView);
}
