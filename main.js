import { initPeerJS, updateConnectionStatus, updatePeerCount } from './peer.js';
import { initNotes, handleClick, handleEnterKey, interpretHTML, maintainEmptyLines, handleScroll } from './display.js';

const display = document.getElementById('notes-display');
const container = document.getElementById('notes-container');

window.addEventListener('load', () => {
    initPeerJS();
    initNotes();
});

window.addEventListener('resize', () => {
    if (window.location.hash) {
        initNotes();
    }
});

display.addEventListener('click', handleClick);
display.addEventListener('keydown', handleEnterKey);
display.addEventListener('input', () => {
    interpretHTML();
    maintainEmptyLines();
    broadcastData();
});
container.addEventListener('scroll', handleScroll);