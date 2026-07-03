import { PrismaClient } from '@prisma/client';
import { SettlementRoute, listEnabledCurrencies } from './currencyBasket';
import { FxQuote, buildQuote } from './quoteEngine';

const prisma = new PrismaClient();

type StoredQuote = {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  notional: number;
  side: string;
  referenceRate: number;
  allInRate: number;
  spreadBps: number;
  feeBps: number;
  quoteTtlSeconds: number;
  expiresAt: Date;
  estimatedSettlementMinutes: number;
  routeId: string;
  routeProvider: string;
  routeRail: string;
  sourceAmount: number;
  targetAmount: number;
  status: string;
  riskChecks: string;
  createdAt: Date;
};

type SettlementInstructionView = {
  id: string;
  reserveId: string;
  status: string;
  routeId: string;
  provider: string;
  rail: string;
  sourceAmount: number;
  sourceCurrency: string;
  targetAmount: number;
  targetCurrency: string;
  releaseGates: string[];
  createdAt: string;
};

type StoredSettlementInstruction = {
  id: string;
  reserveId: string;
  status: string;
  routeId: string;
  provider: string;
  rail: string;
  sourceAmount: number;
  sourceCurrency: string;
  targetAmount: number;
  targetCurrency: string;
  releaseGates: string;
  createdAt: Date;
};

const releaseGates = [
  'sanctions_screen',
  'client_limit_check',
  'route_health_check',
  'settlement_instruction_match'
];

function routeFromQuote(quote: StoredQuote): SettlementRoute {
  return {
    id: quote.routeId,
    sourceCurrency: quote.sourceCurrency,
    targetCurrency: quote.targetCurrency,
    rail: quote.routeRail as SettlementRoute['rail'],
    provider: quote.routeProvider,
    settlementWindowMinutes: quote.estimatedSettlementMinutes,
    feeBps: quote.feeBps,
    enabled: true
  };
}

function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function toQuoteView(quote: StoredQuote): FxQuote {
  return {
    id: quote.id,
    sourceCurrency: quote.sourceCurrency,
    targetCurrency: quote.targetCurrency,
    notional: quote.notional,
    side: quote.side as FxQuote['side'],
    referenceRate: quote.referenceRate,
    allInRate: quote.allInRate,
    spreadBps: quote.spreadBps,
    feeBps: quote.feeBps,
    quoteTtlSeconds: quote.quoteTtlSeconds,
    expiresAt: quote.expiresAt.toISOString(),
    estimatedSettlementMinutes: quote.estimatedSettlementMinutes,
    route: routeFromQuote(quote),
    sourceAmount: quote.sourceAmount,
    targetAmount: quote.targetAmount,
    status: quote.status as FxQuote['status'],
    riskChecks: parseList(quote.riskChecks),
    createdAt: quote.createdAt.toISOString()
  };
}

function toInstructionView(instruction: StoredSettlementInstruction): SettlementInstructionView {
  return {
    id: instruction.id,
    reserveId: instruction.reserveId,
    status: instruction.status,
    routeId: instruction.routeId,
    provider: instruction.provider,
    rail: instruction.rail,
    sourceAmount: instruction.sourceAmount,
    sourceCurrency: instruction.sourceCurrency,
    targetAmount: instruction.targetAmount,
    targetCurrency: instruction.targetCurrency,
    releaseGates: parseList(instruction.releaseGates),
    createdAt: instruction.createdAt.toISOString()
  };
}

export async function createStoredQuote(request: unknown): Promise<FxQuote> {
  const quote = buildQuote(request as Parameters<typeof buildQuote>[0]);

  const storedQuote = await prisma.fxQuote.create({
    data: {
      sourceCurrency: quote.sourceCurrency,
      targetCurrency: quote.targetCurrency,
      notional: quote.notional,
      side: quote.side,
      referenceRate: quote.referenceRate,
      allInRate: quote.allInRate,
      spreadBps: quote.spreadBps,
      feeBps: quote.feeBps,
      quoteTtlSeconds: quote.quoteTtlSeconds,
      expiresAt: new Date(quote.expiresAt),
      estimatedSettlementMinutes: quote.estimatedSettlementMinutes,
      routeId: quote.route.id,
      routeProvider: quote.route.provider,
      routeRail: quote.route.rail,
      sourceAmount: quote.sourceAmount,
      targetAmount: quote.targetAmount,
      riskChecks: JSON.stringify(quote.riskChecks)
    }
  });

  return toQuoteView(storedQuote);
}

export async function listStoredQuotes(): Promise<FxQuote[]> {
  const quotes = await prisma.fxQuote.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100
  });

  return quotes.map(toQuoteView);
}

export async function acceptStoredQuote(quoteId: string): Promise<{
  quote: FxQuote;
  settlementInstruction: SettlementInstructionView;
}> {
  const quote = await prisma.fxQuote.findUnique({ where: { id: quoteId } });
  if (!quote) {
    throw new Error('Quote not found.');
  }

  if (quote.status !== 'QUOTED') {
    throw new Error(`Quote is already ${quote.status}.`);
  }

  if (new Date() > quote.expiresAt) {
    const expiredQuote = await prisma.fxQuote.update({
      where: { id: quote.id },
      data: { status: 'EXPIRED' }
    });
    throw new Error(`Quote expired at ${expiredQuote.expiresAt.toISOString()}.`);
  }

  const reserveId = `reserve_${quote.id}`;
  const result = await prisma.$transaction(async (tx) => {
    const acceptedQuote = await tx.fxQuote.update({
      where: { id: quote.id },
      data: { status: 'ACCEPTED' }
    });

    const instruction = await tx.settlementInstruction.create({
      data: {
        quoteId: quote.id,
        reserveId,
        routeId: quote.routeId,
        provider: quote.routeProvider,
        rail: quote.routeRail,
        sourceAmount: quote.sourceAmount,
        sourceCurrency: quote.sourceCurrency,
        targetAmount: quote.targetAmount,
        targetCurrency: quote.targetCurrency,
        releaseGates: JSON.stringify(releaseGates)
      }
    });

    await tx.treasuryLedgerEntry.createMany({
      data: [
        {
          quoteId: quote.id,
          instructionId: instruction.id,
          account: 'client_source_reserve',
          currency: quote.sourceCurrency,
          direction: 'DEBIT',
          amount: quote.sourceAmount,
          memo: `Reserve source funds for ${reserveId}`
        },
        {
          quoteId: quote.id,
          instructionId: instruction.id,
          account: 'treasury_target_obligation',
          currency: quote.targetCurrency,
          direction: 'CREDIT',
          amount: quote.targetAmount,
          memo: `Record target delivery obligation for ${reserveId}`
        }
      ]
    });

    return { acceptedQuote, instruction };
  });

  return {
    quote: toQuoteView(result.acceptedQuote),
    settlementInstruction: toInstructionView(result.instruction)
  };
}

export async function listSettlementInstructions(): Promise<SettlementInstructionView[]> {
  const instructions = await prisma.settlementInstruction.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100
  });

  return instructions.map(toInstructionView);
}

export async function getTreasuryLedger(limit = 100) {
  return prisma.treasuryLedgerEntry.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit
  });
}

export async function getTreasuryPositions() {
  const entries = await prisma.treasuryLedgerEntry.findMany();
  const reservedByCurrency = new Map<string, number>();

  for (const entry of entries) {
    const current = reservedByCurrency.get(entry.currency) ?? 0;
    reservedByCurrency.set(entry.currency, current + entry.amount);
  }

  return listEnabledCurrencies().slice(0, 20).map((currency) => {
    const reserved = Number((reservedByCurrency.get(currency.code) ?? 0).toFixed(6));

    return {
      currency: currency.code,
      available: 0,
      reserved,
      targetUsdCapacity: currency.maxQuoteUsd,
      utilizationPct: Number(((reserved / currency.maxQuoteUsd) * 100).toFixed(4)),
      status: reserved > 0 ? 'reserved_pending_funding' : 'not_funded'
    };
  });
}

export async function getSettlementReconciliationReport() {
  const instructions = await prisma.settlementInstruction.findMany({
    include: {
      ledgerEntries: true
    },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  const breaks = [];
  let balancedInstructionCount = 0;

  for (const instruction of instructions) {
    const gates = parseList(instruction.releaseGates);
    const ledgerCount = instruction.ledgerEntries.length;
    const hasSourceReserve = instruction.ledgerEntries.some((entry) => entry.account === 'client_source_reserve' && entry.direction === 'DEBIT');
    const hasTargetObligation = instruction.ledgerEntries.some((entry) => entry.account === 'treasury_target_obligation' && entry.direction === 'CREDIT');
    const expectedSource = instruction.sourceAmount;
    const expectedTarget = instruction.targetAmount;
    const sourceReserved = instruction.ledgerEntries
      .filter((entry) => entry.account === 'client_source_reserve' && entry.currency === instruction.sourceCurrency)
      .reduce((sum, entry) => sum + entry.amount, 0);
    const targetObligation = instruction.ledgerEntries
      .filter((entry) => entry.account === 'treasury_target_obligation' && entry.currency === instruction.targetCurrency)
      .reduce((sum, entry) => sum + entry.amount, 0);
    const missingGates = releaseGates.filter((gate) => !gates.includes(gate));
    const balanced = ledgerCount >= 2 &&
      hasSourceReserve &&
      hasTargetObligation &&
      Math.abs(sourceReserved - expectedSource) < 0.000001 &&
      Math.abs(targetObligation - expectedTarget) < 0.000001 &&
      missingGates.length === 0;

    if (balanced) {
      balancedInstructionCount += 1;
    } else {
      breaks.push({
        instructionId: instruction.id,
        reserveId: instruction.reserveId,
        status: instruction.status,
        ledgerCount,
        missingGates,
        sourceDelta: Number((sourceReserved - expectedSource).toFixed(6)),
        targetDelta: Number((targetObligation - expectedTarget).toFixed(6))
      });
    }
  }

  return {
    mode: 'simulation',
    checkedInstructionCount: instructions.length,
    balancedInstructionCount,
    breakCount: breaks.length,
    status: breaks.length === 0 ? 'balanced' : 'breaks_detected',
    controls: [
      'instruction_has_source_reserve_debit',
      'instruction_has_target_obligation_credit',
      'instruction_release_gates_present',
      'instruction_amounts_match_ledger'
    ],
    breaks
  };
}
