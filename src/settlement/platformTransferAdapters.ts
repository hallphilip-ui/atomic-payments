import {
  PlatformTransferConnector,
  TransferCapability,
  listPlatformTransferConnectors
} from './platformTransferConnectors';

export type TransferAdapterMode = 'simulation';

export type PlatformAccountStatus = {
  connectorId: string;
  status: 'simulated_ready';
  transferOnly: true;
  tradingEnabled: false;
  mode: TransferAdapterMode;
  requiredVerification: string[];
};

export type PlatformBalance = {
  asset: string;
  available: string;
  held: string;
};

export type DepositInstructions = {
  connectorId: string;
  asset: string;
  network: string;
  address: string;
  memo?: string;
  mode: TransferAdapterMode;
};

export type TransferStatus = {
  connectorId: string;
  transferId: string;
  status: 'simulated_pending' | 'simulated_observed';
  asset: string;
  amount: string;
  direction: 'deposit' | 'withdrawal';
  mode: TransferAdapterMode;
};

export type WithdrawalRequest = {
  asset: string;
  amount: string;
  destinationAddress: string;
  network?: string;
  memo?: string;
};

export type PlatformTransferAdapter = {
  connector: PlatformTransferConnector;
  mode: TransferAdapterMode;
  allowedCapabilities: TransferCapability[];
  getAccountStatus(): Promise<PlatformAccountStatus>;
  listBalances(): Promise<PlatformBalance[]>;
  getDepositInstructions(asset: string, network?: string): Promise<DepositInstructions>;
  getDepositStatus(transferId: string): Promise<TransferStatus>;
  requestWithdrawal(request: WithdrawalRequest): Promise<TransferStatus>;
  getWithdrawalStatus(transferId: string): Promise<TransferStatus>;
  listTransferEvents(): Promise<TransferStatus[]>;
};

function findConnector(connectorId: string): PlatformTransferConnector {
  const connector = listPlatformTransferConnectors().find((candidate) => candidate.id === connectorId);
  if (!connector) throw new Error(`Unknown platform transfer connector: ${connectorId}`);
  return connector;
}

function simulatedAddress(connectorId: string, asset: string, network: string): string {
  const normalized = `${connectorId}_${asset}_${network}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 28);
  return `atomic_sim_${normalized}`;
}

function assertCapability(connector: PlatformTransferConnector, capability: TransferCapability) {
  if (!connector.transferCapabilities.includes(capability)) {
    throw new Error(`${connector.id} does not support ${capability} in transfer-only mode.`);
  }
}

export function createSimulatedTransferAdapter(connectorId: string): PlatformTransferAdapter {
  const connector = findConnector(connectorId);
  const mode: TransferAdapterMode = 'simulation';

  return {
    connector,
    mode,
    allowedCapabilities: [...connector.transferCapabilities],

    async getAccountStatus() {
      assertCapability(connector, 'account_status');
      return {
        connectorId: connector.id,
        status: 'simulated_ready',
        transferOnly: true,
        tradingEnabled: false,
        mode,
        requiredVerification: [...connector.verificationRequired]
      };
    },

    async listBalances() {
      assertCapability(connector, 'balance_read');
      return [
        { asset: 'USD', available: '0.00', held: '0.00' },
        { asset: 'USDC', available: '0.00', held: '0.00' },
        { asset: 'USDT', available: '0.00', held: '0.00' }
      ];
    },

    async getDepositInstructions(asset, network = 'default') {
      assertCapability(connector, 'deposit_address');
      return {
        connectorId: connector.id,
        asset: asset.toUpperCase(),
        network,
        address: simulatedAddress(connector.id, asset.toUpperCase(), network),
        memo: `atomic-${connector.id}`,
        mode
      };
    },

    async getDepositStatus(transferId) {
      assertCapability(connector, 'deposit_status');
      return {
        connectorId: connector.id,
        transferId,
        status: 'simulated_observed',
        asset: 'USDC',
        amount: '0.00',
        direction: 'deposit',
        mode
      };
    },

    async requestWithdrawal(request) {
      assertCapability(connector, 'withdrawal_request');
      return {
        connectorId: connector.id,
        transferId: `sim_withdrawal_${connector.id}_${Date.now()}`,
        status: 'simulated_pending',
        asset: request.asset.toUpperCase(),
        amount: request.amount,
        direction: 'withdrawal',
        mode
      };
    },

    async getWithdrawalStatus(transferId) {
      assertCapability(connector, 'withdrawal_status');
      return {
        connectorId: connector.id,
        transferId,
        status: 'simulated_pending',
        asset: 'USDC',
        amount: '0.00',
        direction: 'withdrawal',
        mode
      };
    },

    async listTransferEvents() {
      return [];
    }
  };
}
