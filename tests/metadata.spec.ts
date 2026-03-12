import { TimeAction } from '../src/actions';
import { Config } from '../src/config';
import { HIVE_STREAM_METADATA, getHiveStreamMetadata } from '../src/metadata';

describe('metadata exports', () => {
    test('returns a stable frozen metadata object', () => {
        const meta = getHiveStreamMetadata();

        expect(meta).toBe(HIVE_STREAM_METADATA);
        expect(Object.isFrozen(meta)).toBe(true);
        expect(Object.isFrozen(meta.config)).toBe(true);
        expect(Object.isFrozen(meta.subscriptions)).toBe(true);
        expect(Object.isFrozen(meta.writeOperations)).toBe(true);
        expect(Object.isFrozen(meta.namespaces)).toBe(true);
    });

    test('includes config defaults aligned with Config source', () => {
        const map = new Map(HIVE_STREAM_METADATA.config.options.map((option) => [option.key, option.defaultValue]));
        const builderMap = new Map(HIVE_STREAM_METADATA.config.options.map((option) => [option.key, option.builderKey]));

        expect(map.get('JSON_ID')).toBe(Config.JSON_ID);
        expect(map.get('PAYLOAD_IDENTIFIER')).toBe(Config.PAYLOAD_IDENTIFIER);
        expect(map.get('HIVE_ENGINE_ID')).toBe(Config.HIVE_ENGINE_ID);
        expect(map.get('BLOCK_CHECK_INTERVAL')).toBe(Config.BLOCK_CHECK_INTERVAL);
        expect(map.get('API_ENABLED')).toBe(Config.API_ENABLED);
        expect(map.get('API_PORT')).toBe(Config.API_PORT);
        expect(builderMap.get('JSON_ID')).toBe('jsonId');
        expect(builderMap.get('PAYLOAD_IDENTIFIER')).toBe('payloadIdentifier');
        expect(builderMap.get('BLOCK_CHECK_INTERVAL')).toBe('blockCheckInterval');
        expect(builderMap.get('API_ENABLED')).toBe('apiEnabled');
        expect(builderMap.get('API_PORT')).toBe('apiPort');
    });

    test('includes expected subscription metadata', () => {
        const transfer = HIVE_STREAM_METADATA.subscriptions.find((item) => item.method === 'onTransfer');
        const customJsonId = HIVE_STREAM_METADATA.subscriptions.find((item) => item.method === 'onCustomJsonId');

        expect(transfer).toBeDefined();
        expect(transfer?.accountFilterBuiltIn).toBe(true);

        expect(customJsonId).toBeDefined();
        expect(customJsonId?.idFilterBuiltIn).toBe(true);
    });

    test('includes burn helpers in write operation metadata', () => {
        const burnHive = HIVE_STREAM_METADATA.writeOperations.find((item) => item.method === 'burnHiveTokens');
        const burnTransferPortion = HIVE_STREAM_METADATA.writeOperations.find((item) => item.method === 'burnTransferPortion');
        const burnTransferPercentage = HIVE_STREAM_METADATA.writeOperations.find((item) => item.method === 'burnTransferPercentage');
        const autoBurnIncomingTransfers = HIVE_STREAM_METADATA.writeOperations.find((item) => item.method === 'autoBurnIncomingTransfers');
        const autoForwardIncomingTransfers = HIVE_STREAM_METADATA.writeOperations.find((item) => item.method === 'autoForwardIncomingTransfers');
        const autoRefundIncomingTransfers = HIVE_STREAM_METADATA.writeOperations.find((item) => item.method === 'autoRefundIncomingTransfers');
        const autoSplitIncomingTransfers = HIVE_STREAM_METADATA.writeOperations.find((item) => item.method === 'autoSplitIncomingTransfers');
        const autoRouteIncomingTransfers = HIVE_STREAM_METADATA.writeOperations.find((item) => item.method === 'autoRouteIncomingTransfers');
        const burnHiveEngine = HIVE_STREAM_METADATA.writeOperations.find((item) => item.method === 'burnHiveEngineTokens');

        expect(burnHive?.signature).toBe('burnHiveTokens(from, amount, symbol, memo?)');
        expect(burnTransferPortion?.signature).toBe('burnTransferPortion(from, transferOrAmount, basisPoints, memo?, allowedSymbols?)');
        expect(burnTransferPercentage?.signature).toBe('burnTransferPercentage(from, transferOrAmount, percentage, memo?, allowedSymbols?)');
        expect(autoBurnIncomingTransfers?.signature).toBe('autoBurnIncomingTransfers(options)');
        expect(autoForwardIncomingTransfers?.signature).toBe('autoForwardIncomingTransfers(options)');
        expect(autoRefundIncomingTransfers?.signature).toBe('autoRefundIncomingTransfers(options?)');
        expect(autoSplitIncomingTransfers?.signature).toBe('autoSplitIncomingTransfers(options)');
        expect(autoRouteIncomingTransfers?.signature).toBe('autoRouteIncomingTransfers(options)');
        expect(burnHiveEngine?.signature).toBe('burnHiveEngineTokens(from, symbol, quantity, memo?)');
    });

    test('exposes valid time action values from TimeAction source', () => {
        expect(HIVE_STREAM_METADATA.timeAction.validValues).toEqual(TimeAction.getValidTimeValues());
    });

    test('lists contract triggers and supported operations', () => {
        expect(HIVE_STREAM_METADATA.contracts.payload.supportedTriggers).toEqual([
            'custom_json',
            'transfer',
            'time',
            'escrow_transfer',
            'escrow_approve',
            'escrow_dispute',
            'escrow_release',
            'recurrent_transfer'
        ]);

        expect(HIVE_STREAM_METADATA.contracts.payload.supportedOperations).toEqual([
            'transfer',
            'custom_json',
            'escrow_transfer',
            'recurrent_transfer'
        ]);
    });

    test('includes provider metadata with 3 entries', () => {
        expect(HIVE_STREAM_METADATA.providers).toBeDefined();
        expect(HIVE_STREAM_METADATA.providers).toHaveLength(3);

        const names = HIVE_STREAM_METADATA.providers.map((p) => p.exportName);
        expect(names).toEqual(['HiveProvider', 'HafProvider', 'HafClient']);
    });

    test('includes money and flows namespaces for tooling discovery', () => {
        const money = HIVE_STREAM_METADATA.namespaces.find((item) => item.name === 'money');
        const flows = HIVE_STREAM_METADATA.namespaces.find((item) => item.name === 'flows');
        const ops = HIVE_STREAM_METADATA.namespaces.find((item) => item.name === 'ops');

        expect(money?.methods.map((method) => method.method)).toEqual(
            expect.arrayContaining([
                'parseAssetAmount',
                'formatAmount',
                'formatAssetAmount',
                'calculatePercentageAmount',
                'calculateBasisPointsAmount',
                'splitAmountByBasisPoints',
                'splitAmountByPercentage',
                'splitAmountByWeights'
            ])
        );

        expect(flows?.methods.map((method) => method.method)).toEqual(
            expect.arrayContaining([
                'incomingTransfers',
                'autoBurnIncomingTransfers',
                'autoForwardIncomingTransfers',
                'autoRefundIncomingTransfers',
                'autoSplitIncomingTransfers',
                'autoRouteIncomingTransfers',
                'planIncomingTransferRoutes'
            ])
        );

        expect(ops?.methods.map((method) => method.method)).toEqual(
            expect.arrayContaining([
                'transfer',
                'burn',
                'escrowTransfer',
                'recurrentTransfer',
                'createProposal',
                'transferEngine',
                'burnEngine',
                'issueEngine',
                'voteProposals',
                'removeProposals',
                'upvote',
                'downvote'
            ])
        );
    });

    test('keeps helper exports aligned with the expanded contract catalog', () => {
        expect(HIVE_STREAM_METADATA.contracts.helperExports).toEqual(
            expect.arrayContaining([
                'createInsurancePoolContract',
                'createOracleBountyContract',
                'createGrantRoundsContract',
                'createPayrollContract',
                'createProposalTimelockContract',
                'createBundleMarketplaceContract',
                'createTicketingContract',
                'createFanClubContract'
            ])
        );
    });
});
