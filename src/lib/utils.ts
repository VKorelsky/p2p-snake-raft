export const getRandomNumber = (max) => {
	return Math.floor(Math.random() * max);
};

// export const capitalize = (str: string): string => {
// 	return str.charAt(0).toUpperCase() + str.slice(1);
// };

// export const log = (message: string, ...data: unknown[]) => {
// 	console.log(message, data);
// };

export const generateRandomString = () => {
	const words = [
		'apple',
		'banana',
		'cherry',
		'date',
		'elderberry',
		'fig',
		'grape',
		'honeydew',
		'kiwi',
		'lemon',
		'mango',
		'nectarine',
		'orange',
		'papaya',
		'quince',
		'raspberry',
		'strawberry',
		'tangerine',
		'ugli',
		'vanilla',
		'watermelon',
		'xigua',
		'yam',
		'zucchini',
		'apricot',
		'blueberry',
		'cantaloupe',
		'dragonfruit',
		'guava',
		'jackfruit',
		'kumquat',
		'lychee',
		'mulberry',
		'nectar',
		'olive',
		'peach',
		'plum',
		'pineapple',
		'raspberry',
		'soursop',
		'tamarind',
		'ugli-fruit',
		'watercress',
		'yuzu',
		'zest'
	];

	let sentence = '';
	for (let i = 0; i < 3; i++) {
		const word = words[getRandomNumber(words.length)];
		sentence += i > 0 ? `-${word}` : `${word}`;
	}

	return sentence;
};
