import { initLocation } from './location.js';
import { loadNearbyBuses, unloadNearbyBuses } from './tools/nearbyBuses.js';
import { loadSubwayPosition } from './tools/subwayPosition.js';

// Request location permission once at startup so it's ready when tools need it
initLocation();

const content = document.getElementById('app-content');
const navButtons = document.querySelectorAll('.nav-btn');

const tools = {
    'nearby-buses': { load: loadNearbyBuses, unload: unloadNearbyBuses },
    'subway-position': { load: loadSubwayPosition, unload: null },
};

let activeTool = null;

function activateTool(toolName) {
    if (activeTool && tools[activeTool]?.unload) {
        tools[activeTool].unload();
    }

    activeTool = toolName;

    navButtons.forEach(btn => {
        const isActive = btn.dataset.tool === toolName;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-current', isActive ? 'page' : 'false');
    });

    tools[toolName]?.load(content);

    // Move focus to the main content area when a tool is activated
    content.focus();
}

navButtons.forEach(btn => {
    btn.addEventListener('click', () => activateTool(btn.dataset.tool));
});
