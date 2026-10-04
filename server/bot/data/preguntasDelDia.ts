// Preguntas para la "Pregunta del día". Todas son para romper el hielo y aptas para todo público.
// Puedes agregar más al final de la lista: el bot las irá mezclando sin repetir hasta agotarlas.
export const PREGUNTAS_DEL_DIA: readonly string[] = [
  // 🎮 Videojuegos
  '¿Cuál fue el primer videojuego que te voló la cabeza y por qué?',
  'Si pudieras vivir dentro de un videojuego durante una semana, ¿cuál escogerías?',
  '¿Qué juego te gustaría borrar de tu memoria para volver a jugarlo como si fuera la primera vez?',
  '¿Cuál es el jefe (boss) más difícil al que te has enfrentado?',
  '¿Eres más de jugar solo, en cooperativo o en competitivo?',
  '¿Qué personaje de videojuego sería el peor roomie del mundo?',
  '¿Qué juego viejito merece un remake ya?',
  'Consola, PC o celular: ¿dónde juegas más y por qué?',
  '¿Cuál es tu juego "comfort" para cuando tienes un mal día?',
  'Arma un equipo de 3 personajes de videojuegos para sobrevivir a un apocalipsis zombi. 🧟',

  // 🎵 Música
  '¿Qué canción traes pegada en la cabeza esta semana?',
  '¿Qué canción pones para echarte ánimos?',
  'Si tu vida fuera una película, ¿qué canción sonaría en los créditos finales?',
  '¿Cuál es tu placer culposo musical? Aquí nadie juzga. 🎶',
  '¿Qué artista o banda le recomendarías a alguien que nunca lo ha escuchado?',
  '¿Cuál ha sido el mejor concierto de tu vida (o a cuál sueñas con ir)?',
  'Comparte una canción que te recuerde a tu infancia.',
  '¿Qué género musical nunca pensaste que te gustaría y terminó encantándote?',

  // 🌮 Comida
  'Tacos al pastor, de suadero o de asada: ¿cuál gana y por qué? 🌮',
  '¿Qué comida podrías comer toda una semana sin aburrirte?',
  '¿Cuál es la combinación de comida más rara que te gusta?',
  '¿Chilaquiles verdes o rojos? Defiende tu respuesta.',
  '¿Qué platillo te sale mejor cuando cocinas?',
  'Si abrieras un restaurante, ¿qué venderías y cómo se llamaría?',
  '¿Cuál es el mejor antojito para una noche de lluvia?',
  '¿Pizza con piña: sí o no? 🍍',
  '¿Cuál es tu dulce típico favorito (de México o de tu país)?',
  '¿Cuál es tu botana ideal para un maratón de series?',

  // 🤔 Hipotéticas
  'Si pudieras tener un superpoder solo por un día, ¿cuál escogerías y qué harías con él?',
  'Si te ganaras la lotería mañana, ¿qué sería lo primero que comprarías?',
  'Si pudieras viajar en el tiempo una sola vez, ¿irías al pasado o al futuro?',
  'Si tu mascota (real o imaginaria) pudiera hablar, ¿qué crees que te diría?',
  'Si pudieras dominar cualquier habilidad al instante, ¿cuál sería?',
  'Si te quedaras en una isla desierta, ¿qué tres cosas llevarías? 🏝️',
  'Si pudieras cenar con cualquier personaje ficticio, ¿a quién invitarías?',
  'Si pudieras cambiar una sola regla del mundo, ¿cuál cambiarías?',
  'Si fueras un NPC, ¿qué frase repetirías todo el día?',
  'Si pudieras teletransportarte a cualquier lugar ahora mismo, ¿a dónde irías?',
  'Si tuvieras un robot asistente, ¿qué tarea le darías primero? 🤖',
  'Si pudieras vivir en cualquier época de la historia, ¿cuál escogerías?',

  // ⚖️ ¿Qué prefieres?
  '¿Qué prefieres: poder volar o ser invisible?',
  '¿Qué prefieres: playa o montaña? 🏖️⛰️',
  '¿Qué prefieres: no volver a usar redes sociales o no volver a ver películas?',
  '¿Qué prefieres: madrugar o desvelarte?',
  '¿Qué prefieres: hablar todos los idiomas o poder hablar con los animales?',
  '¿Qué prefieres: un día de lluvia en casa o un día soleado afuera?',
  '¿Qué prefieres: saber el final de todas las películas o nunca poder ver un final?',
  '¿Qué prefieres: internet ilimitado para siempre o comida gratis de por vida?',
  '¿Qué prefieres: viajar al espacio o al fondo del mar?',
  '¿Qué prefieres: perros o gatos? 🐶🐱',

  // 🎬 Series, películas y anime
  '¿Qué serie o anime recomendarías para ver este fin de semana?',
  '¿Qué película has visto más veces en tu vida?',
  '¿Qué personaje de película o serie se parece más a ti?',
  '¿Qué final de serie te dejó con el corazón roto? (¡sin spoilers fuertes!)',
  '¿Qué película te daba miedo de niño y ahora te da risa?',
  'Si pudieras entrar a cualquier universo de anime, película o serie, ¿cuál sería?',

  // 😄 Sobre ti
  '¿Qué cosa pequeña te hizo feliz esta semana?',
  '¿Cuál es tu pasatiempo más reciente?',
  '¿Qué habilidad rara tienes que poca gente conoce?',
  '¿Cuál es el mejor consejo que te han dado?',
  '¿Qué te gustaría aprender este año?',
  '¿Cuál es tu lugar favorito para relajarte?',
  'Describe tu día ideal usando solo tres emojis.',
  '¿Cuál es el apodo más chistoso que te han puesto?',
  '¿Cuál es tu meme favorito de todos los tiempos?',
  '¿Qué app de tu celular no podrías dejar de usar?',
  '¿Eres más de mañana, tarde o noche? 🌅🌙',
  '¿Qué lugar del mundo quieres conocer antes de que termine la década?',
  '¿Qué fue lo último que te hizo reír a carcajadas?',
  '¿Qué haces cuando no puedes dormir?',

  // 💡 Creatividad y debates ligeros
  '¿Cuál es la mejor caricatura de tu infancia?',
  '¿Cuál es el invento más útil de la historia, según tú?',
  'Inventa un nuevo día festivo: ¿cómo se llamaría y cómo se celebraría? 🎉',
  '¿Qué objeto de todos los días crees que está sobrevalorado?',
  '¿Cuál es la mejor época del año y por qué?',
  'Si este servidor tuviera una mascota oficial, ¿qué animal sería y cómo se llamaría?',
  '¿Qué emoji usas más y qué dice eso de ti?',
  '¿Qué tradición de tu familia o de tu ciudad te gusta mucho?',
  '¿Qué meta pequeña quieres cumplir esta semana? 💪',
  'Recomienda algo (juego, canción, serie o comida) que todos aquí deberían probar.',
];
