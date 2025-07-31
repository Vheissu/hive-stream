import { SqliteAdapter } from "../../src/adapters/sqlite.adapter";
import fs from 'fs';
import path from 'path';

describe('SQLite Adapter', () => {
    let sut: SqliteAdapter;
    let testDbPath: string;

    beforeEach(async () => {
        testDbPath = path.resolve(__dirname, `../../src/adapters/hive-stream-test-basic-${Date.now()}-${Math.random()}.db`);
        
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        
        sut = new SqliteAdapter(testDbPath);
        await sut.create();
    });

    afterEach(async () => {
        if (sut && sut.getDb()) {
            await sut.destroy();
        }
        
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    test('find method returns values', async () => {
        jest.spyOn(sut.db, 'all').mockImplementation((query: any, params: any, callback: any) => {
            return callback(null, [{ id: 1, name: 'John' }]);
        });

        const result = await sut.find('USERS', { id: 1, name: 'John' });

        expect(result).toEqual([{ id: 1, name: 'John' }]);
        expect(sut.db.all).toHaveBeenCalledWith('SELECT * FROM USERS WHERE id = ? AND name = ?', [1, 'John'], expect.any(Function));
    });

    test('findOne method returns value', async () => {
        jest.spyOn(sut.db, 'get').mockImplementation((query: any, params: any, callback: any) => {
            return callback(null, { id: 1, name: 'John' });
        });

        const result = await sut.findOne('USERS', { id: 1, name: 'John', email: 'john@hotmail.com' });

        expect(result).toEqual({ id: 1, name: 'John' });
        expect(sut.db.get).toHaveBeenCalledWith('SELECT * FROM USERS WHERE id = ? AND name = ? AND email = ?', [1, 'John', 'john@hotmail.com'], expect.any(Function));
    });

    test('replace method replaces value', async () => {
        jest.spyOn(sut.db, 'run').mockImplementation((query: any, params: any, callback: any) => {
            return callback(null, { id: 1, name: 'John' });
        });

        const result = await sut.replace('USERS', { id: 1, name: 'John' }, { id: 2, name: 'Johnny' });

        expect(result).toEqual({ id: 2, name: 'Johnny' });
        expect(sut.db.run).toHaveBeenCalledWith('REPLACE INTO USERS (id, name) VALUES (?, ?)', [2, 'Johnny'], expect.any(Function));
    });
});