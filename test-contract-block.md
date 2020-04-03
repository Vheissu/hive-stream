42189228

hive_keychain.requestCustomJson('beggars', 'hivedice', 'active', JSON.stringify({ hiveContract: { name: 'hivedice', action: 'roll', payload: { roll: 22, direction: 'lesserThan'} } }), 'Test', function(response) {
	console.log(response);
});

42203941
Transfer memo payload

{"hiveContract":{"name":"hivedice","action":"roll","payload":{"roll":22,"direction":"lesserThan"}}}

42208330
Transfer memo, amount higher than max

42209768
Transfer memo, valid bet