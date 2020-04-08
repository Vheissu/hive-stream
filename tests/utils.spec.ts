import { Utils } from './../src/utils';

describe('Utils', () => {

    test('Should generate two deterministic numbers', () => {
        // Should generate a deterministic random number
        expect(Utils.randomNumber('dasdasdas', '2312fsdfsdfsdf', 'kfjlksdjflksdjf999')).toStrictEqual(26);

        expect(Utils.randomNumber('fdfsdfsdfsdfsf', '2312fsdfsdfsdf', 'kfjlksdjflksdjf999')).toStrictEqual(43);
    });

    test('Should shuffle array in a non-deterministic way', () => {
        const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
        const arrayCloned = [...array];
        
        Utils.shuffle(array);

        expect(array).not.toMatchObject(arrayCloned);
    });

});