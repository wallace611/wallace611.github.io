// Map Visualization and Interaction Logic (map-renderer.js)

// Global state variables for the map (exposed to script.js via window)
let mapData = null; // The latest system state data
let mapState = {
    // Initial zoom and pan (0, 0)
    zoom: 1.0,
    panX: 0,
    panY: 0,
    isDragging: false,
    lastX: 0,
    lastY: 0
};

// Map dimension state, used for centered zooming
let mapDimensions = {
    width: 0,
    height: 0,
    autoScale: 1.0,
    autoOffsetX: 0,
    autoOffsetY: 0
};

// ** NEW: 路徑歷史和覆蓋區域的狀態 **
const shipHistory = {}; // { shipName: [{x, z}, {x, z}, ...] }
let coverageCanvas = null; // HTMLCanvasElement for drawing scanned areas
let coverageContext = null; // CanvasRenderingContext2D

const MAX_HISTORY_POINTS = 50; // 最大儲存點數，防止記憶體溢出
const MIN_DISTANCE_SQUARED = 100; // 船隻移動超過 10*10=100 單位才記錄，減少點數

/**
 * Resets the map pan and zoom to the default "fit to view" state.
 */
function resetMapView() {
    mapState.zoom = 1.0;
    mapState.panX = 0;
    mapState.panY = 0;
    
    // ** 重置路徑歷史 **
    for (const key in shipHistory) {
        delete shipHistory[key];
    }
    
    // ** 清空覆蓋區域畫布 **
    if (coverageContext) {
        coverageContext.clearRect(0, 0, mapDimensions.width, mapDimensions.height);
    }

    if (mapData) {
        // 重置時，需要使用最新的 mapData 重新繪製
        const persons = mapData.personsInDistress.persons || [];
        // ** 只傳遞 savedPersons **
        const savedPersons = persons.filter(p => p.isSaved); 
        updateMap(mapData, savedPersons);
    }
}

/**
 * Adjusts the map zoom level, keeping the view center fixed.
 * [Implementation remains the same]
 * @param {number} factor - The zoom factor (e.g., 1.2 for zoom in, 1/1.2 for zoom out).
 */
function zoomMap(factor) {
    if (!mapData || !mapDimensions.width) return;
    
    const W = mapDimensions.width;
    const H = mapDimensions.height;
    const Z_old = mapState.zoom;
    
    // 1. Calculate the new zoom value and limit range
    const newZoom = Math.max(0.5, Math.min(5.0, Z_old * factor));
    const actualFactor = newZoom / Z_old;

    if (actualFactor === 1) return;

    // 2. Calculate the pan required to keep the center fixed
    const V_center_relative_X = W / 2 - mapDimensions.autoOffsetX;
    const V_center_relative_Y = H / 2 - mapDimensions.autoOffsetY;

    // Apply the pan adjustment for centered zoom
    mapState.panX = V_center_relative_X * (1 - actualFactor) + mapState.panX * actualFactor;
    mapState.panY = V_center_relative_Y * (1 - actualFactor) + mapState.panY * actualFactor;
    
    // 3. Update zoom
    mapState.zoom = newZoom;
    
    // 重新繪製時，使用當前過濾後的遇難者數據
    const persons = mapData.personsInDistress.persons || [];
    // ** 只傳遞 savedPersons **
    const savedPersons = persons.filter(p => p.isSaved); 
    updateMap(mapData, savedPersons);
}

/**
 * Draws the grid lines and labels on the map canvas.
 * [Implementation remains the same]
 * @param {HTMLElement} canvas - The map container element.
 * @param {number} minX - Minimum X coordinate in data.
 * @param {number} maxX - Maximum X coordinate in data.
 * @param {number} minZ - Minimum Z coordinate in data.
 * @param {number} maxZ - Maximum Z coordinate in data.
 * @param {number} scale - Final scaling factor.
 * @param {number} offsetX - Final X offset.
 * @param {number} offsetY - Final Y offset.
 * @param {number} width - Canvas width in pixels.
 * @param {number} height - Canvas height in pixels.
 * @param {number} mapRangeZ - The Z range of the data, used for Y-inversion.
 */
function drawGrid(canvas, minX, maxX, minZ, maxZ, scale, offsetX, offsetY, width, height, mapRangeZ) {
    // Dynamically adjust grid interval based on zoom level (scale)
    // 網格間距調整為變疏 (所有值乘以約 2 倍)
    let gridIntervalMeters = 20; // 預設 20m 一格 (原 10m)

    if (scale > 10) { 
        gridIntervalMeters = 10; // 原 5m
    } else if (scale < 2) { 
         gridIntervalMeters = 40; // 原 20m
    } else if (scale < 1) { 
         gridIntervalMeters = 100; // 原 50m
    } else if (scale < 0.5) {
         gridIntervalMeters = 200; // 原 100m
    }
    
    // 1. Vertical Grid Lines (X-axis)
    const firstX = Math.floor(minX / gridIntervalMeters) * gridIntervalMeters;
    
    for (let x = firstX; x <= maxX + gridIntervalMeters; x += gridIntervalMeters) {
        const pixelX = x * scale + offsetX;
        
        if (pixelX >= 0 && pixelX <= width) {
            const line = document.createElement('div');
            line.className = 'grid-line grid-x';
            line.style.left = pixelX + 'px';
            canvas.appendChild(line);

            const label = document.createElement('div');
            label.className = 'grid-label grid-label-x';
            label.textContent = `X: ${x.toFixed(0)}`;
            label.style.left = pixelX + 'px';
            canvas.appendChild(label);
        }
    }

    // 2. Horizontal Grid Lines (Z-axis)
    const firstZ = Math.floor(minZ / gridIntervalMeters) * gridIntervalMeters;

    for (let z = firstZ; z <= maxZ + gridIntervalMeters; z += gridIntervalMeters) {
        // ** Y-axis Inversion for grid labels: use the same logic as markers **
        const invertedZ = maxZ - z + minZ; 
        const pixelZ = invertedZ * scale + offsetY; 

        if (pixelZ >= 0 && pixelZ <= height) {
            const line = document.createElement('div');
            line.className = 'grid-line grid-z';
            line.style.top = pixelZ + 'px';
            canvas.appendChild(line);

            const label = document.createElement('div');
            label.className = 'grid-label grid-label-z';
            label.textContent = `Z: ${z.toFixed(0)}`; // Display the original Z value
            label.style.top = pixelZ + 'px';
            canvas.appendChild(label);
        }
    }
}


/**
 * Helper: Converts map coordinates (X, Z) to screen pixel coordinates (x, y).
 * [Implementation remains the same]
 * @param {number} mapX - Ship X coordinate.
 * @param {number} mapZ - Ship Z coordinate.
 * @param {object} transform - Contains maxZ, minZ, finalScale, finalOffsetX, finalOffsetY.
 * @returns {object} {x: pixelX, y: pixelY}
 */
function mapToScreen(mapX, mapZ, transform) {
    const invertedZ = transform.maxZ - mapZ + transform.minZ; 
    const x = mapX * transform.finalScale + transform.finalOffsetX;
    const y = invertedZ * transform.finalScale + transform.finalOffsetY;
    return { x, y };
}

/**
 * Renders the map visualization, including markers, grid, and detection ranges.
 * **MODIFIED: Now accepts savedPersons array as the second argument**
 * @param {object} data - The current system state.
 * @param {Array<object>} savedPersons - List of persons to display (isSaved: true).
 */
function updateMap(data, savedPersons) {
    const canvas = document.getElementById('canvas');
    const container = document.getElementById('canvas-container');
    
    // Remove all DOM elements except the canvas, legend and stats
    let childrenToRemove = Array.from(canvas.children).filter(child => 
        !child.classList.contains('legend') && 
        !child.classList.contains('map-stats') &&
        !child.id.startsWith('coverage-canvas') // Keep the canvas element
    );
    childrenToRemove.forEach(child => canvas.removeChild(child));
    
    const width = container.offsetWidth;
    const height = container.offsetHeight; 
    
    // 1. Calculate the bounds of all points (including detection range)
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    // Provide a default range if no data points exist
    if (data.ships.length === 0 && savedPersons.length === 0) { // Use savedPersons length
         minX = 0; maxX = 100; minZ = 0; maxZ = 100;
    } else {
        data.ships.forEach(ship => {
            minX = Math.min(minX, ship.position.x - ship.detectionRange); 
            maxX = Math.max(maxX, ship.position.x + ship.detectionRange);
            minZ = Math.min(minZ, ship.position.z - ship.detectionRange);
            maxZ = Math.max(maxZ, ship.position.z + ship.detectionRange);
        });
        
        // Use savedPersons for calculating bounds
        savedPersons.forEach(person => {
            minX = Math.min(minX, person.position.x);
            maxX = Math.max(maxX, person.position.x);
            minZ = Math.min(minZ, person.position.z);
            maxZ = Math.max(maxZ, person.position.z);
        });
    }

    // 2. Calculate Auto-Scaling and Auto-Centering (the baseline view)
    const rangeX = maxX - minX;
    const rangeZ = maxZ - minZ;
    let autoScale = 1.0;
    let autoOffsetX = 0;
    let autoOffsetY = 0;

    if (rangeX > 0 && rangeZ > 0) {
        autoScale = Math.min((width - 100) / rangeX, (height - 100) / rangeZ);
        const centerX = (minX + maxX) / 2;
        autoOffsetX = (width / 2) - centerX * autoScale;
        autoOffsetY = (height / 2) - ((maxZ + minZ) / 2) * autoScale;
    } else {
        autoScale = 5; 
        autoOffsetX = width / 2;
        autoOffsetY = height / 2;
        minX = 0; maxX = 0; minZ = 0; maxZ = 0; 
    }

    // Store the calculated dimensions for zoomMap to use
    mapDimensions.width = width;
    mapDimensions.height = height;
    mapDimensions.autoScale = autoScale;
    mapDimensions.autoOffsetX = autoOffsetX;
    mapDimensions.autoOffsetY = autoOffsetY;

    // 3. Apply User Pan and Zoom to get Final Transforms
    const finalScale = autoScale * mapState.zoom;
    const finalOffsetX = autoOffsetX + mapState.panX; 
    const finalOffsetY = autoOffsetY + mapState.panY; 

    const transform = { minZ, maxZ, finalScale, finalOffsetX, finalOffsetY };

    // ** 4. Draw Grid and Paths **
    drawGrid(canvas, minX, maxX, minZ, maxZ, finalScale, finalOffsetX, finalOffsetY, width, height, rangeZ);
    
    // ** Ensure Coverage Canvas Exists and is Sized Correctly **
    initializeCoverageCanvas(canvas, width, height);

    // ** 5. Draw Ships, Ranges, and Paths **
    
    // Draw ships and their ranges
    data.ships.forEach(ship => {
        const { x, y: z } = mapToScreen(ship.position.x, ship.position.z, transform);
        
        // --- 處理路徑歷史和繪製 ---
        updateShipHistory(ship.name, ship.position.x, ship.position.z);
        //drawShipPath(canvas, ship.name, transform); // 重新啟用路徑繪製

        // --- 繪製偵測範圍圓圈 ---
        if (ship.detectionRange > 0) {
            // ** 累計繪製覆蓋區域 (在 Canvas 上) **
            //drawCoverageArea(ship.position.x, ship.position.z, ship.detectionRange, transform); // 重新啟用覆蓋區域繪製

            // ** 繪製當前範圍虛線 (在 DOM 上) **
            const rangeDiv = document.createElement('div');
            rangeDiv.className = 'detection-range';
            const radiusPx = ship.detectionRange * finalScale;
            rangeDiv.style.width = (radiusPx * 2) + 'px';
            rangeDiv.style.height = (radiusPx * 2) + 'px';
            rangeDiv.style.left = x + 'px';
            rangeDiv.style.top = z + 'px';
            canvas.appendChild(rangeDiv);
        }

        // --- 繪製船隻標記 ---
        const div = document.createElement('div');
        div.className = `map-ship ${ship.isWaiting ? 'ship-waiting' : ''}`;
        div.style.left = x + 'px';
        div.style.top = z + 'px';
        div.innerHTML = `
            <div class="ship-icon"></div>
            <div class="ship-label">${ship.name}</div>
        `;
        canvas.appendChild(div);
    });
    
    // Draw persons in distress (using the filtered list - ONLY SAVED)
    savedPersons.forEach(person => {
        const { x, y: z } = mapToScreen(person.position.x, person.position.z, transform);
        
        // 已獲救人員使用藍色標記
        const personClass = 'map-person map-person-saved'; 

        const div = document.createElement('div');
        div.className = personClass;
        div.style.left = x + 'px';
        div.style.top = z + 'px';
        
        // 顯示獲救圖標和標籤
        div.innerHTML = `
            <div class="person-icon"></div>
            <div class="person-label">已獲救 ID ${person.id}</div> 
        `;
        canvas.appendChild(div);
    });
    
    // 6. Update Map Statistics
    // Calculate distance only to SAVED persons (因為只有他們的位置是已知的)
    if (data.ships.length > 0 && savedPersons.length > 0) { 
        let totalDistance = 0;
        let count = 0;
        
        data.ships.forEach(ship => {
            savedPersons.forEach(person => {
                const dx = ship.position.x - person.position.x;
                const dz = ship.position.z - person.position.z;
                const distance = Math.sqrt(dx * dx + dz * dz);
                totalDistance += distance;
                count++;
            });
        });
        
        const avgDistance = (totalDistance / count).toFixed(1);
        document.getElementById('avgDistance').textContent = avgDistance + 'm';
        document.getElementById('mapRange').textContent = 
            `${rangeX.toFixed(0)}m × ${rangeZ.toFixed(0)}m`;
    } else {
         document.getElementById('avgDistance').textContent = '--';
         document.getElementById('mapRange').textContent = '--';
    }
}


// ==========================================
// Path History & Coverage Functions 
// [Implementations remain the same]
// ==========================================

/**
 * Ensures the dedicated coverage canvas element exists and is correctly sized.
 * [Implementation remains the same]
 * @param {HTMLElement} canvas - The main map div.
 * @param {number} width - Canvas width.
 * @param {number} height - Canvas height.
 */
function initializeCoverageCanvas(canvas, width, height) {
    if (!coverageCanvas) {
        coverageCanvas = document.createElement('canvas');
        coverageCanvas.id = 'coverage-canvas';
        // Set z-index lower than markers and grid
        coverageCanvas.style.cssText = 'position: absolute; top: 0; left: 0; z-index: 3;'; 
        canvas.appendChild(coverageCanvas);
        coverageContext = coverageCanvas.getContext('2d');
    }
    
    // Always update dimensions in case of resize or pan reset
    if (coverageCanvas.width !== width || coverageCanvas.height !== height) {
        coverageCanvas.width = width;
        coverageCanvas.height = height;
    }

    // Set canvas transform to match current pan/zoom state for persistent drawing
    coverageCanvas.style.transform = `translate(${mapState.panX}px, ${mapState.panY}px) scale(${mapState.zoom})`;
    coverageCanvas.style.transformOrigin = 'center center';
}


/**
 * Stores the ship's current position to the history array.
 * [Implementation remains the same]
 */
function updateShipHistory(name, x, z) {
    if (!shipHistory[name]) {
        shipHistory[name] = [];
    }
    const history = shipHistory[name];

    // Only record if moved significantly from the last recorded point
    if (history.length > 0) {
        const lastPos = history[history.length - 1];
        const dx = x - lastPos.x;
        const dz = z - lastPos.z;
        if (dx * dx + dz * dz < MIN_DISTANCE_SQUARED) {
            return;
        }
    }

    history.push({ x, z });

    // Limit history length
    if (history.length > MAX_HISTORY_POINTS) {
        history.shift();
    }
}

/**
 * Draws the path line for a single ship using DOM elements.
 * [Implementation remains the same]
 */
function drawShipPath(canvas, name, transform) {
    const history = shipHistory[name];
    if (!history || history.length < 2) return;

    // Use a Polyline element for the path
    const pathDiv = document.createElement('div');
    pathDiv.className = 'ship-path-container';
    pathDiv.style.position = 'absolute';
    pathDiv.style.top = '0';
    pathDiv.style.left = '0';
    pathDiv.style.width = '100%';
    pathDiv.style.height = '100%';
    pathDiv.style.zIndex = '4'; // Behind markers (10) and detection range (5)
    canvas.appendChild(pathDiv);
    
    // Use an SVG element to draw the actual path for smooth lines
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');

    let points = "";
    
    // Apply path translation based on current pan and scale for DOM elements
    const scale = transform.finalScale;
    const offsetX = transform.finalOffsetX;
    const offsetY = transform.finalOffsetY;
    
    history.forEach(pos => {
        // Map history coordinates to screen pixels using current transform
        const { x, y: z } = mapToScreen(pos.x, pos.z, transform);
        points += `${x},${z} `;
    });
    
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute('points', points);
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', '#66BB6A'); // Green for path
    polyline.setAttribute('stroke-width', '2');
    polyline.setAttribute('opacity', '0.7');
    
    svg.appendChild(polyline);
    pathDiv.appendChild(svg);
}


/**
 * Draws the coverage area (search sweep) using a persistent HTML Canvas.
 * [Implementation remains the same]
 */
function drawCoverageArea(mapX, mapZ, range, transform) {
    if (!coverageContext || !coverageCanvas) return;

    const ctx = coverageContext;

    // Convert map coordinate to a pixel position relative to the UNPANNED/UNZOOMED baseline
    const baselineScale = mapDimensions.autoScale;
    const baselineOffsetX = mapDimensions.autoOffsetX;
    const baselineOffsetY = mapDimensions.autoOffsetY;

    // Y-INVERSION CORE LOGIC for baseline:
    const invertedZ = transform.maxZ - mapZ + transform.minZ; 
    
    const baselineX = mapX * baselineScale + baselineOffsetX;
    const baselineY = invertedZ * baselineScale + baselineOffsetY;

    const radiusPx = range * baselineScale;

    // Draw the circle on the canvas
    ctx.beginPath();
    // Draw the circle at its BLUESKY coordinate (unpanned, unzoomed by mapState)
    ctx.arc(baselineX, baselineY, radiusPx, 0, 2 * Math.PI);
    
    ctx.fillStyle = 'rgba(255, 255, 0, 0.05)'; // Pale yellow, very low opacity
    ctx.fill();
}


// --- Map Panning Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('canvas');
    
    // Mouse Down: Start dragging
    canvas.addEventListener('mousedown', (e) => {
        mapState.isDragging = true;
        mapState.lastX = e.clientX;
        mapState.lastY = e.clientY;
        canvas.classList.add('dragging');
        e.preventDefault(); // Prevent default browser drag behavior
    });
    
    // Mouse Move: Calculate and apply pan (listens on document for smoother drag outside canvas)
    document.addEventListener('mousemove', (e) => {
        if (!mapState.isDragging) return;
        
        const dx = e.clientX - mapState.lastX;
        const dy = e.clientY - mapState.lastY;
        
        mapState.panX += dx;
        mapState.panY += dy;
        
        mapState.lastX = e.clientX;
        mapState.lastY = e.clientY;

        // ** Move the coverage canvas with the pan/zoom **
        if (coverageCanvas) {
            coverageCanvas.style.transform = `translate(${mapState.panX}px, ${mapState.panY}px) scale(${mapState.zoom})`;
        }
        
        if (window.mapData) {
            // Only update DOM elements (markers, grid, path SVG)
            const allPersons = window.mapData.personsInDistress.persons || [];
            // ** 傳遞 savedPersons **
            const savedPersons = allPersons.filter(p => p.isSaved); 
            window.updateMap(window.mapData, savedPersons);
        }
    });
    
    // Mouse Up: Stop dragging
    document.addEventListener('mouseup', () => {
        mapState.isDragging = false;
        canvas.classList.remove('dragging');
    });
    
    // Handle window resize event
    window.addEventListener('resize', () => {
        if (window.mapData) {
            const allPersons = window.mapData.personsInDistress.persons || [];
            // ** 傳遞 savedPersons **
            const savedPersons = allPersons.filter(p => p.isSaved); 
            window.updateMap(window.mapData, savedPersons);
        }
    });

    // Expose functions and state globally for script.js and index.html
    window.updateMap = updateMap;
    window.resetMapView = resetMapView;
    window.zoomMap = zoomMap;
    window.mapState = mapState;
    window.setMapData = (data) => {
        mapData = data;
    };
    window.mapData = mapData; // Also expose mapData for event listeners
});