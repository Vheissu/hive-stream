import cron from 'node-cron';

export const TimeValue = {
    Block: '*/3 * * * * *', // Every 3 seconds
    Daily: '0 0 */24 * * *', // Every 24 hours
    Hourly: '0 0 */1 * * *', // Every hour
    TwelveHours: '0 0 */12 * * *' // Every twelve hours
};

export class TimeAction {
    date;

    constructor(public timeValue: string, public contractName: string, public contractMethod: string) {
        this.date = new Date();
    }
}