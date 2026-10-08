// "npm run dev": arranca BotM en modo desarrollo (node --import ./scripts/env-development.mjs …).
// Se pone aquí y no con cross-env para que BotM sea el único proceso de Node que recibe Ctrl + C:
// cross-env (y el proceso padre de tsx) reenvían la señal con kill(), que en Windows termina el proceso
// de golpe y no le deja cerrar la base de datos integrada.
process.env.NODE_ENV = 'development';
