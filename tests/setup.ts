import { GlobalWithFetchMock } from 'jest-fetch-mock';

// (global as any).console = {
//     log: jest.fn(), // console.log are ignored in tests

//     // Keep native behaviour for other methods, use those to print out things in your own tests, not `console.log`
//     error: console.error,
//     warn: console.warn,
//     info: console.info,
//     debug: console.debug,
// };

const fetchMock = require('jest-fetch-mock');
const customGlobal: GlobalWithFetchMock = global as unknown as GlobalWithFetchMock;

// Safely assign fetch mock
if (!customGlobal.fetch) {
    customGlobal.fetch = fetchMock;
} else {
    Object.defineProperty(customGlobal, 'fetch', {
        value: fetchMock,
        writable: true,
        configurable: true
    });
}
customGlobal.fetchMock = customGlobal.fetch;

process.on('unhandledRejection', (error) => {
  throw error; // Or whatever you like...
});