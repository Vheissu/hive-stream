export class TimeAction {
    constructor(public timeValue: string, public id: string, public contractName: string, public contractMethod: string, public payload: any = {}, public date = new Date()) {

    }

    reset() {
        this.date = new Date();
    }
}