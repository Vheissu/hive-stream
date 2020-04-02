import { Utils } from './../src/utils';

describe('Utils', () => {

    test('Should generate two deterministic numbers', () => {
        // Should generate a deterministic random number
        expect(Utils.randomNumber('dasdasdas', '2312fsdfsdfsdf', 'kfjlksdjflksdjf999')).toStrictEqual(26);

        expect(Utils.randomNumber('fdfsdfsdfsdfsf', '2312fsdfsdfsdf', 'kfjlksdjflksdjf999')).toStrictEqual(43);
    });

});