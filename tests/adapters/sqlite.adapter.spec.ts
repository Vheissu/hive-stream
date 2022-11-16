import { SqliteAdapter } from "../../src/adapters/sqlite.adapter";


describe('SQLite Adapter', () => {
    let sut: SqliteAdapter;

    beforeEach(() => {
        sut = new SqliteAdapter();
    });

    test('find method returns values', async () => {
        jest.spyOn(sut.db, 'all').mockImplementation((query: any, callback: any) => {
            return callback(null, [{ id: 1, name: 'John' }]);
        });

        const result = await sut.find('USERS', { id: 1, name: 'John' });

        expect(result).toEqual([{ id: 1, name: 'John' }]);
        expect(sut.db.all).toHaveBeenCalledWith('SELECT * FROM USERS WHERE id = 1 AND name = John', expect.any(Function));
    });

    test('findOne method returns value', async () => {
        jest.spyOn(sut.db, 'get').mockImplementation((query: any, callback: any) => {
            return callback(null, { id: 1, name: 'John' });
        });

        const result = await sut.findOne('USERS', { id: 1, name: 'John', email: 'john@hotmail.com' });

        expect(result).toEqual({ id: 1, name: 'John' });
        expect(sut.db.get).toHaveBeenCalledWith('SELECT * FROM USERS WHERE id = 1 AND name = John AND email = john@hotmail.com', expect.any(Function));
    });

    test('replace method replaces value', async () => {
        jest.spyOn(sut.db, 'run').mockImplementation((query: any, callback: any) => {
            return callback(null, { id: 1, name: 'John' });
        });

        const result = await sut.replace('USERS', { id: 1, name: 'John' }, { id: 2, name: 'Johnny' });

        expect(result).toEqual({ id: 2, name: 'Johnny' });
        expect(sut.db.run).toHaveBeenCalledWith(`REPLACE INTO USERS id = 1 AND name = John VALUES ([object Object])`, expect.any(Function));
    });
});