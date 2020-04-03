42189228

hive_keychain.requestCustomJson('beggars', 'hivedice', 'active', JSON.stringify({ hiveContract: { name: 'hivedice', action: 'roll', payload: { roll: 22, amount: '1'} } }), 'Test', function(response) {
	console.log(response);
});

42203941
Transfer memo payload