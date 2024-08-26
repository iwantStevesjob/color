import { initNotes, handleClick, interpretHTML, handleEnterKey, handleScroll, maintainEmptyLines, broadcastData } from './display.js';
import { initPeerJS, updateConnectionStatus, connectToPeer, setupConnectionListeners } from './peer.js';

let connections = [];
let isServer = false;

window.addEventListener('load', () => {
    initPeerJS();
    initNotes();
});

window.addEventListener('resize', () => {
    if (isServer) initNotes();
});

document.getElementById('notes-display').addEventListener('click', handleClick);
document.getElementById('notes-display').addEventListener('keydown', handleEnterKey);
document.getElementById('notes-display').addEventListener('input', () => {
    interpretHTML();
    maintainEmptyLines();
    broadcastData(connections);
});

document.getElementById('notes-container').addEventListener('scroll', handleScroll);

export { connections, isServer };