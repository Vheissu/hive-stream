export class TimeAction {
    date;

    constructor(public timeValue: string, public id: string, public contractName: string, public contractMethod: string) {
        this.date = new Date();
    }
}