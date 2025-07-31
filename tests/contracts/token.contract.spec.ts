import { TokenContract } from '../../src/contracts/token.contract';
import { MockAdapter } from '../helpers/mock-adapter';

describe('TokenContract', () => {
    let tokenContract: TokenContract;
    let mockAdapter: MockAdapter;
    let mockStreamer: any;

    beforeEach(() => {
        mockAdapter = new MockAdapter();
        mockStreamer = {
            getAdapter: () => mockAdapter
        };

        tokenContract = new TokenContract();
        tokenContract._instance = mockStreamer;
        tokenContract.updateBlockInfo(12345, 'block123', 'prevblock123', 'txn123');
    });

    describe('createToken', () => {
        it('should create a new token successfully', async () => {
            mockAdapter.reset();
            tokenContract.create();
            mockAdapter.setQueryResult([]); // No existing token with same symbol

            const payload = {
                symbol: 'TEST',
                name: 'Test Token',
                precision: 3,
                maxSupply: '1000000'
            };

            await (tokenContract as any).createToken(payload, { sender: 'alice' });

            const insertQuery = mockAdapter.queries.find(q => q.includes('INSERT INTO tokens'));
            expect(insertQuery).toBeDefined();
            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('createToken');
        });

        it('should reject invalid token symbol', async () => {
            const payload = {
                symbol: 'invalid-symbol',
                name: 'Test Token',
                maxSupply: '1000000'
            };

            await expect((tokenContract as any).createToken(payload, { sender: 'alice' }))
                .rejects.toThrow('Symbol must be 1-10 uppercase alphanumeric characters');
        });

        it('should reject invalid max supply', async () => {
            const payload = {
                symbol: 'TEST',
                name: 'Test Token',
                maxSupply: '0'
            };

            await expect((tokenContract as any).createToken(payload, { sender: 'alice' }))
                .rejects.toThrow('Maximum supply must be between 1 and 9007199254740991');
        });

        it('should reject max supply too large', async () => {
            const payload = {
                symbol: 'TEST',
                name: 'Test Token',
                maxSupply: '9007199254740992'
            };

            await expect((tokenContract as any).createToken(payload, { sender: 'alice' }))
                .rejects.toThrow('Maximum supply must be between 1 and 9007199254740991');
        });

        it('should reject invalid precision', async () => {
            const payload = {
                symbol: 'TEST',
                name: 'Test Token',
                precision: 9,
                maxSupply: '1000000'
            };

            await expect((tokenContract as any).createToken(payload, { sender: 'alice' }))
                .rejects.toThrow('Precision must be between 0 and 8');
        });

        it('should create token with URL', async () => {
            mockAdapter.reset();
            tokenContract.create();
            mockAdapter.setQueryResult([]); // No existing token with same symbol

            const payload = {
                symbol: 'TEST',
                name: 'Test Token',
                url: 'https://example.com/token',
                precision: 3,
                maxSupply: '1000000'
            };

            await (tokenContract as any).createToken(payload, { sender: 'alice' });

            const insertQuery = mockAdapter.queries.find(q => q.includes('INSERT INTO tokens'));
            expect(insertQuery).toBeDefined();
            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('createToken');
        });

        it('should reject URL too long', async () => {
            const longUrl = 'https://example.com/' + 'a'.repeat(250);
            const payload = {
                symbol: 'TEST',
                name: 'Test Token',
                url: longUrl,
                maxSupply: '1000000'
            };

            await expect((tokenContract as any).createToken(payload, { sender: 'alice' }))
                .rejects.toThrow('URL must be 256 characters or less');
        });
    });

    describe('issueTokens', () => {
        it('should issue tokens successfully', async () => {
            mockAdapter.reset();
            mockAdapter.setTestContext({ noExistingBalance: true });
            tokenContract.create();
            
            mockAdapter.setQueryResult([{
                symbol: 'TEST',
                name: 'Test Token',
                creator: 'alice',
                precision: 3,
                current_supply: '0',
                max_supply: '1000000'
            }]);

            const payload = {
                symbol: 'TEST',
                to: 'bob',
                amount: '100',
                memo: 'Initial distribution'
            };

            await (tokenContract as any).issueTokens(payload, { sender: 'alice' });

            const updateQuery = mockAdapter.queries.find(q => q.includes('UPDATE tokens SET current_supply'));
            const insertQuery = mockAdapter.queries.find(q => q.includes('INSERT INTO token_balances'));
            expect(updateQuery).toBeDefined();
            expect(insertQuery).toBeDefined();
            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('issueTokens');
        });

        it('should reject issuance by non-creator', async () => {
            mockAdapter.reset();
            tokenContract.create();
            
            mockAdapter.setQueryResult([{
                symbol: 'TEST',
                name: 'Test Token',
                creator: 'alice',
                precision: 3,
                current_supply: '0',
                max_supply: '1000000'
            }]);

            const payload = {
                symbol: 'TEST',
                to: 'bob',
                amount: '100'
            };

            await expect((tokenContract as any).issueTokens(payload, { sender: 'charlie' }))
                .rejects.toThrow('Only the token creator can issue new tokens');
        });

        it('should reject issuance exceeding max supply', async () => {
            mockAdapter.reset();
            mockAdapter.setTestContext({ maxSupplyExceeded: true });
            tokenContract.create();
            
            mockAdapter.setQueryResult([{
                symbol: 'TEST',
                name: 'Test Token',
                creator: 'alice',
                precision: 3,
                current_supply: '999999',
                max_supply: '1000000'
            }]);

            const payload = {
                symbol: 'TEST',
                to: 'bob',
                amount: '100'
            };

            await expect((tokenContract as any).issueTokens(payload, { sender: 'alice' }))
                .rejects.toThrow('Cannot issue tokens: would exceed maximum supply');
        });
    });

    describe('transferTokens', () => {
        it('should transfer tokens successfully', async () => {
            mockAdapter.reset();
            tokenContract.create();

            const payload = {
                symbol: 'TEST',
                to: 'bob',
                amount: '100',
                memo: 'Payment'
            };

            await (tokenContract as any).transferTokens(payload, { sender: 'alice' });

            const updateQuery = mockAdapter.queries.find(q => q.includes('UPDATE token_balances SET balance'));
            const insertQuery = mockAdapter.queries.find(q => q.includes('INSERT INTO token_transfers'));
            expect(updateQuery).toBeDefined();
            expect(insertQuery).toBeDefined();
            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('transferTokens');
        });

        it('should reject transfer with insufficient balance', async () => {
            mockAdapter.reset();
            mockAdapter.setTestContext({ insufficientBalance: true });
            tokenContract.create();

            const payload = {
                symbol: 'TEST',
                to: 'bob',
                amount: '100'
            };

            await expect((tokenContract as any).transferTokens(payload, { sender: 'alice' }))
                .rejects.toThrow('Insufficient balance');
        });

        it('should reject transfer of non-existent token', async () => {
            mockAdapter.reset();
            mockAdapter.setTestContext({ nonExistentToken: 'NONEXISTENT' });
            tokenContract.create();

            const payload = {
                symbol: 'NONEXISTENT',
                to: 'bob',
                amount: '100'
            };

            await expect((tokenContract as any).transferTokens(payload, { sender: 'alice' }))
                .rejects.toThrow('Token NONEXISTENT does not exist');
        });
    });

    describe('getBalance', () => {
        it('should return balance for existing account', async () => {
            mockAdapter.reset();
            tokenContract.create();
            
            mockAdapter.setQueryResult([{ balance: '500' }]);

            const payload = {
                account: 'alice',
                symbol: 'TEST'
            };

            await (tokenContract as any).getBalance(payload, { sender: 'bob' });

            const selectQuery = mockAdapter.queries.find(q => q.includes('SELECT balance FROM token_balances'));
            expect(selectQuery).toBeDefined();
            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('getBalance');
        });

        it('should return zero balance for non-existent account', async () => {
            mockAdapter.reset();
            mockAdapter.setTestContext({ zeroBalance: true });
            tokenContract.create();

            const payload = {
                account: 'alice',
                symbol: 'TEST'
            };

            await (tokenContract as any).getBalance(payload, { sender: 'bob' });

            expect(mockAdapter.events[0].data.data.balance).toBe('0');
        });
    });

    describe('getTokenInfo', () => {
        it('should return token information', async () => {
            mockAdapter.reset();
            tokenContract.create();
            
            const tokenData = {
                symbol: 'TEST',
                name: 'Test Token',
                url: 'https://example.com/token',
                precision: 3,
                max_supply: '1000000',
                current_supply: '500000',
                creator: 'alice',
                created_at: new Date()
            };

            mockAdapter.setQueryResult([tokenData]);

            const payload = {
                symbol: 'TEST'
            };

            await (tokenContract as any).getTokenInfo(payload, { sender: 'bob' });

            const selectQuery = mockAdapter.queries.find(q => q.includes('SELECT * FROM tokens'));
            expect(selectQuery).toBeDefined();
            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('getTokenInfo');
            expect(mockAdapter.events[0].data.data.token_info).toEqual(tokenData);
        });

        it('should reject request for non-existent token', async () => {
            mockAdapter.reset();
            mockAdapter.setTestContext({ nonExistentToken: 'NONEXISTENT' });
            tokenContract.create();

            const payload = {
                symbol: 'NONEXISTENT'
            };

            await expect((tokenContract as any).getTokenInfo(payload, { sender: 'bob' }))
                .rejects.toThrow('Token NONEXISTENT does not exist');
        });
    });
});