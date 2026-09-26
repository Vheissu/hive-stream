import { Streamer } from '../src/streamer';
import { Utils } from '../src/utils';

describe('Streamer.broadcastOperations key selection', () => {
    let streamer: Streamer;
    let spy: jest.SpyInstance;

    beforeEach(() => {
        streamer = new Streamer({ activeKey: 'ACTIVE', postingKey: 'POSTING' });
        spy = jest.spyOn(Utils, 'broadcastOperations').mockReturnValue(Promise.resolve({} as any) as any);
    });

    afterEach(() => {
        spy.mockRestore();
    });

    test('signs posting-authority custom_json with the posting key', () => {
        streamer.broadcastOperations([['custom_json', { id: 'app', json: '{}', required_auths: [], required_posting_auths: ['alice'] }]]);
        expect(spy.mock.calls[0][2]).toBe('POSTING');
    });

    test('signs active-authority custom_json with the active key', () => {
        streamer.broadcastOperations([['custom_json', { id: 'app', json: '{}', required_auths: ['alice'], required_posting_auths: [] }]]);
        expect(spy.mock.calls[0][2]).toBe('ACTIVE');
    });

    test('signs transfers with the active key', () => {
        streamer.broadcastOperations([['transfer', { from: 'alice', to: 'bob', amount: '1.000 HIVE', memo: '' }]]);
        expect(spy.mock.calls[0][2]).toBe('ACTIVE');
    });

    test('explicit signing keys win', () => {
        streamer.broadcastOperations([['custom_json', { id: 'app', json: '{}', required_auths: ['alice'], required_posting_auths: [] }]], 'OTHER');
        expect(spy.mock.calls[0][2]).toBe('OTHER');
    });
});
