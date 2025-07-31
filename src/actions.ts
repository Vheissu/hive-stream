export interface TimeActionInterface {
    timeValue: string;
    id: string;
    contractName: string;
    contractMethod: string;
    payload: any;
    date: Date;
    enabled: boolean;
    lastExecution?: Date;
    executionCount: number;
    maxExecutions?: number;
    timezone?: string;
}

export class TimeAction implements TimeActionInterface {
    public timeValue: string;
    public id: string;
    public contractName: string;
    public contractMethod: string;
    public payload: any;
    public date: Date;
    public enabled: boolean;
    public lastExecution?: Date;
    public executionCount: number;
    public maxExecutions?: number;
    public timezone?: string;
    
    private static readonly VALID_TIME_VALUES = [
        '3s', 'block', '10s', '30s', '1m', '5m', 'minute', '15m', 'quarter',
        '30m', 'halfhour', 'hourly', '1h', '12h', 'halfday', '24h', 
        'day', 'daily', 'week', 'weekly'
    ];

    constructor(
        timeValue: string, 
        id: string, 
        contractName: string, 
        contractMethod: string, 
        payload: any = {},
        date: Date | string = new Date(),
        enabled: boolean = true,
        executionCount: number = 0,
        maxExecutions?: number,
        timezone?: string
    ) {
        this.validateTimeValue(timeValue);
        this.validateId(id);
        this.validateContractName(contractName);
        this.validateMethodName(contractMethod);
        
        this.timeValue = timeValue;
        this.id = id;
        this.contractName = contractName;
        this.contractMethod = contractMethod;
        this.payload = payload || {};
        this.date = this.parseDate(date);
        this.enabled = enabled;
        this.executionCount = executionCount;
        this.maxExecutions = maxExecutions;
        this.timezone = timezone || 'UTC';
    }

    private validateTimeValue(timeValue: string): void {
        if (!timeValue || typeof timeValue !== 'string') {
            throw new Error('TimeAction: timeValue must be a non-empty string');
        }
        
        if (!TimeAction.VALID_TIME_VALUES.includes(timeValue)) {
            throw new Error(`TimeAction: Invalid timeValue '${timeValue}'. Valid values are: ${TimeAction.VALID_TIME_VALUES.join(', ')}`);
        }
    }

    private validateId(id: string): void {
        if (!id || typeof id !== 'string') {
            throw new Error('TimeAction: id must be a non-empty string');
        }
        
        if (id.length > 255) {
            throw new Error('TimeAction: id must not exceed 255 characters');
        }
        
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
            throw new Error('TimeAction: id can only contain alphanumeric characters, underscores, and hyphens');
        }
    }

    private validateContractName(contractName: string): void {
        if (!contractName || typeof contractName !== 'string') {
            throw new Error('TimeAction: contractName must be a non-empty string');
        }
    }

    private validateMethodName(methodName: string): void {
        if (!methodName || typeof methodName !== 'string') {
            throw new Error('TimeAction: contractMethod must be a non-empty string');
        }
    }

    private parseDate(date: Date | string): Date {
        if (date instanceof Date) {
            return date;
        }
        
        if (typeof date === 'string') {
            const parsed = new Date(date);
            if (isNaN(parsed.getTime())) {
                throw new Error(`TimeAction: Invalid date string '${date}'`);
            }
            return parsed;
        }
        
        throw new Error('TimeAction: date must be a Date object or valid date string');
    }

    public reset(): void {
        this.date = new Date();
        this.lastExecution = undefined;
    }

    public disable(): void {
        this.enabled = false;
    }

    public enable(): void {
        this.enabled = true;
    }

    public hasReachedMaxExecutions(): boolean {
        return this.maxExecutions !== undefined && this.executionCount >= this.maxExecutions;
    }

    public incrementExecutionCount(): void {
        this.executionCount++;
        this.lastExecution = new Date();
    }

    public toJSON(): Record<string, any> {
        return {
            timeValue: this.timeValue,
            id: this.id,
            contractName: this.contractName,
            contractMethod: this.contractMethod,
            payload: this.payload,
            date: this.date.toISOString(),
            enabled: this.enabled,
            lastExecution: this.lastExecution?.toISOString(),
            executionCount: this.executionCount,
            maxExecutions: this.maxExecutions,
            timezone: this.timezone
        };
    }

    public static fromJSON(data: any): TimeAction {
        if (!data || typeof data !== 'object') {
            throw new Error('TimeAction.fromJSON: data must be a valid object');
        }
        
        const action = new TimeAction(
            data.timeValue,
            data.id,
            data.contractName,
            data.contractMethod,
            data.payload,
            data.date,
            data.enabled !== undefined ? data.enabled : true,
            data.executionCount || 0,
            data.maxExecutions,
            data.timezone
        );
        
        // Handle lastExecution separately since it's not a constructor parameter
        if (data.lastExecution) {
            action.lastExecution = new Date(data.lastExecution);
        }
        
        return action;
    }

    public static getValidTimeValues(): string[] {
        return [...TimeAction.VALID_TIME_VALUES];
    }
}