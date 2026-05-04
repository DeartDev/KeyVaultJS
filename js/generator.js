/**
 * generator.js
 * Funciones de utilidad para generar contraseñas seguras aleatorias.
 */

const PasswordGenerator = (() => {
    const chars = {
        lowercase: 'abcdefghijklmnopqrstuvwxyz',
        uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        numbers: '0123456789',
        symbols: '!@#$%^&*()_+~`|}{[]:;?><,./-='
    };

    const generate = (length = 16, options = { uppercase: true, numbers: true, symbols: true }) => {
        let charset = chars.lowercase;
        if (options.uppercase) charset += chars.uppercase;
        if (options.numbers) charset += chars.numbers;
        if (options.symbols) charset += chars.symbols;

        let password = '';
        const values = new Uint32Array(length);
        crypto.getRandomValues(values);

        // Garantizar al menos uno de cada tipo solicitado si es posible
        if (options.uppercase) password += chars.uppercase[crypto.getRandomValues(new Uint32Array(1))[0] % chars.uppercase.length];
        if (options.numbers) password += chars.numbers[crypto.getRandomValues(new Uint32Array(1))[0] % chars.numbers.length];
        if (options.symbols) password += chars.symbols[crypto.getRandomValues(new Uint32Array(1))[0] % chars.symbols.length];
        
        while (password.length < length) {
            password += charset[crypto.getRandomValues(new Uint32Array(1))[0] % charset.length];
        }

        // Mezclar la contraseña generada
        return password.split('').sort(() => 0.5 - Math.random()).join('');
    };

    return {
        generate
    };
})();
