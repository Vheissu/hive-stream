/**
 * Test utilities for mocking fetch and external APIs
 */

import { jest } from '@jest/globals';

// Mock Response class that properly implements the Response interface
export class MockResponse {
    public readonly status: number;
    public readonly statusText: string;
    public readonly ok: boolean;
    public readonly headers: Headers;
    public readonly redirected: boolean = false;
    public readonly type: ResponseType = 'default';
    public readonly url: string = '';
    public readonly body: ReadableStream<Uint8Array> | null = null;
    public readonly bodyUsed: boolean = false;

    private data: any;

    constructor(data: any, options: { status?: number; statusText?: string; headers?: HeadersInit } = {}) {
        this.data = data;
        this.status = options.status || 200;
        this.statusText = options.statusText || 'OK';
        this.ok = this.status >= 200 && this.status < 300;
        this.headers = new Headers(options.headers);
    }

    async json(): Promise<any> {
        return this.data;
    }

    async text(): Promise<string> {
        return typeof this.data === 'string' ? this.data : JSON.stringify(this.data);
    }

    async arrayBuffer(): Promise<ArrayBuffer> {
        throw new Error('arrayBuffer not implemented in mock');
    }

    async blob(): Promise<Blob> {
        throw new Error('blob not implemented in mock');
    }

    async formData(): Promise<FormData> {
        throw new Error('formData not implemented in mock');
    }

    async bytes(): Promise<Uint8Array> {
        throw new Error('bytes not implemented in mock');
    }

    clone(): MockResponse {
        return new MockResponse(this.data, {
            status: this.status,
            statusText: this.statusText,
            headers: this.headers
        });
    }
}

/**
 * Create a mock fetch function with predefined responses
 */
export function createMockFetch(responses: { [url: string]: any } = {}) {
    return jest.fn().mockImplementation((...args: any[]) => {
        const url = args[0] as string;
        
        // Handle URL patterns
        if (url.includes('coingecko.com')) {
            return Promise.resolve(new MockResponse({
                hive: { usd: 0.25 },
                'hive_dollar': { usd: 1.00 }
            }));
        }

        if (url.includes('fawazahmed0.github.io') && url.includes('/latest/currencies/usd.json')) {
            return Promise.resolve(new MockResponse({
                usd: {
                    eur: 0.85,
                    gbp: 0.73,
                    jpy: 110.0,
                    cad: 1.25,
                    aud: 1.35
                }
            }));
        }

        // Handle specific URLs from responses object
        if (responses[url]) {
            return Promise.resolve(new MockResponse(responses[url]));
        }

        // Default error response
        return Promise.reject(new Error(`Unmocked URL: ${url}`));
    });
}

/**
 * Mock successful API responses for all endpoints
 */
export function mockSuccessfulApis() {
    const mockFetch = createMockFetch();
    global.fetch = mockFetch as any;
    return mockFetch;
}

/**
 * Mock network errors for testing error handling
 */
export function mockNetworkErrors() {
    const mockFetch = jest.fn().mockImplementation(() => 
        Promise.reject(new Error('Network error'))
    );
    global.fetch = mockFetch as any;
    return mockFetch;
}

/**
 * Mock timeout errors
 */
export function mockTimeoutErrors() {
    const mockFetch = jest.fn().mockImplementation(() => 
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), 100);
        })
    );
    global.fetch = mockFetch as any;
    return mockFetch;
}

/**
 * Mock invalid JSON responses
 */
export function mockInvalidResponses() {
    const mockFetch = jest.fn().mockImplementation(() => 
        Promise.resolve(new MockResponse('invalid json', { status: 200 }))
    );
    global.fetch = mockFetch as any;
    return mockFetch;
}

/**
 * Mock HTTP error responses
 */
export function mockHttpErrors(status: number = 500) {
    const mockFetch = jest.fn().mockImplementation(() => 
        Promise.resolve(
            new MockResponse({ error: 'Server error' }, { status, statusText: 'Internal Server Error' })
        )
    );
    global.fetch = mockFetch as any;
    return mockFetch;
}

/**
 * Clean up mocks after tests
 */
export function cleanupMocks() {
    jest.clearAllMocks();
    // Reset fetch to original if needed
    if (global.fetch && 'mockRestore' in global.fetch) {
        (global.fetch as any).mockRestore();
    }
}
