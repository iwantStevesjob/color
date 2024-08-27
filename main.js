window.addEventListener('load', () => {
    window.initPeerJS();
    initNotes();
});

window.addEventListener('resize', () => {
    lastScrollTop = container.scrollTop;
    initNotes();
});
