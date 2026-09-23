import './style.css';
import { Game } from './game/Game';

const app = document.getElementById('app');
if (!app) throw new Error('#app not found');
const game = new Game(app);

if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { __game: ReturnType<Game['debugApi']> }).__game = game.debugApi();
}
