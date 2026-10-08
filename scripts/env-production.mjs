// "npm start": arranca BotM compilado en modo producción (node --import ./scripts/env-production.mjs …).
// Se pone aquí y no con cross-env para que BotM sea el único proceso de Node que recibe Ctrl + C:
// cross-env reenvía la señal con kill(), que en Windows termina el proceso de golpe y no le deja cerrar
// la base de datos integrada.
process.env.NODE_ENV = 'production';
