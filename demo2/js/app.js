// JavaScript for Maritime Search and Rescue System Monitoring Dashboard

// Global variables for connectivity
const API_URL = ' https://e11ec6899e71.ngrok-free.app'; // 注意：API URL 根據您的 Unity 伺服器 port 調整為 8080

const UPDATE_INTERVAL_MS = 100; // 設置每 100ms 更新一次 (10 FPS)

/**
 * Starts the simulation data polling loop.
 */
function startPolling() {
    fetchState(); 
    
    // Set up the polling interval
    setInterval(fetchState, UPDATE_INTERVAL_MS);

    // Update connection status immediately after starting polling
    updateConnectionStatus(true);
}

/**
 * Manually fetches the current simulation state via REST API.
 */
async function fetchState() {
    try {
        const response = await fetch(`${API_URL}/status`); 
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        window.setMapData(data); // Pass data to map renderer
        updateUI(data);
        updateConnectionStatus(true); // Success
    } catch (error) {
        console.error('Fetch error:', error);
        updateConnectionStatus(false); // Failure
    }
}

/**
 * Sends a request to the backend to reset the simulation.
 */
async function resetSimulation() {
    try {
        // 假設重置端點為 /reset (請根據您的 Unity 後端調整)
        await fetch(`${API_URL}/reset`, { method: 'POST' }); 
        console.log('Simulation reset');
        if (window.resetMapView) window.resetMapView(); // Call map function
        fetchState(); // Manually fetch state after reset
    } catch (error) {
        console.error('Reset error:', error);
    }
}

/**
 * Sends a command to the specified ship(s).
 * [Implementation remains the same]
 * @param {string} commandEndpoint - The command endpoint (e.g., '/start', '/pause', '/return').
 */
async function sendShipCommand(commandEndpoint) {
    const select = document.getElementById('shipSelect');
    const selectedValue = select.value;
    
    if (!selectedValue) {
        alert('請先選擇船隻!');
        return;
    }

    try {
        let apiUrl;
        let commandName = commandEndpoint.replace('/', '');

        if (selectedValue === 'ALL') {
            // 對所有船隻發送指令 (假設後端支持 ALL=all ships)
            apiUrl = `${API_URL}${commandEndpoint}?shipName=ALL`; 
            console.log(`Sending command '${commandName}' to ALL ships via: ${apiUrl}`);
        } else {
            // 對單一船隻發送指令
            apiUrl = `${API_URL}${commandEndpoint}?shipName=${selectedValue}`; 
            console.log(`Sending command '${commandName}' to ${selectedValue} via: ${apiUrl}`);
        }

        // 使用 POST 方法發送指令
        const response = await fetch(apiUrl, { method: 'POST' });

        if (!response.ok) {
            throw new Error(`Command failed with status: ${response.status}`);
        }

        console.log(`Command ${commandName} sent successfully to ${selectedValue}.`);
        fetchState(); // 指令發送後立即更新狀態
        
    } catch (error) {
        console.error(`Error sending command ${commandEndpoint}:`, error);
        alert(`發送指令失敗: ${error.message}`);
    }
}

/**
 * Updates the connection status indicator (connected/disconnected).
 * [Implementation remains the same]
 * @param {boolean} isConnected - True if connected, false otherwise.
 */
function updateConnectionStatus(isConnected) {
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
        statusElement.className = isConnected ? 'connection-status connected' : 'connection-status disconnected';
    }
}

/**
 * Populates the ship selection dropdown menu.
 * [Implementation remains the same]
 * @param {Array} ships - List of ship data.
 */
function populateShipSelect(ships) {
    const select = document.getElementById('shipSelect');
    // Save the current selection to restore it later
    const selectedValue = select.value;

    select.innerHTML = ''; // Clear existing options
    
    // Add "All Ships" option first
    const allOption = document.createElement('option');
    allOption.value = 'ALL';
    allOption.textContent = '所有船隻';
    select.appendChild(allOption);

    // Add individual ship options
    ships.forEach(ship => {
        const option = document.createElement('option');
        option.value = ship.name;
        option.textContent = ship.name;
        select.appendChild(option);
    });

    // Restore previous selection if still valid
    if (selectedValue && Array.from(select.options).some(opt => opt.value === selectedValue)) {
        select.value = selectedValue;
    } else {
        select.value = 'ALL';
    }
}


/**
 * Updates all UI elements with the latest data from the backend.
 * @param {object} data - The system state object.
 */
function updateUI(data) {
    // 呼叫新增的下拉選單更新函式
    populateShipSelect(data.ships);

    const allPersons = data.personsInDistress.persons || [];
    // 只有已獲救人員才應在地圖和列表中顯示位置資訊
    const savedPersons = allPersons.filter(p => p.isSaved); 
    const unsavedCount = allPersons.filter(p => !p.isSaved).length;
    
    // Update phase
    document.getElementById('phase').textContent = data.phase;
    
    // Calculate active ships
    const activeShips = data.ships.filter(s => !s.isWaiting).length;
    
    // Update basic status information
    document.getElementById('theta').textContent = data.theta.toFixed(1) + '°';
    document.getElementById('shipCount').textContent = data.ships.length;
    document.getElementById('activeShips').textContent = activeShips;
    
    // 總遇難人數
    document.getElementById('personCount').textContent = data.personsInDistress.count;
    // 列表顯示已獲救人員數量
    document.getElementById('personCountInList').textContent = savedPersons.length;
    document.getElementById('timestamp').textContent = 'N/A';
    
    // Update ship list
    const shipsList = document.getElementById('shipsList');
    shipsList.innerHTML = data.ships.map(ship => `
        <div class="ship-item ${ship.isWaiting ? 'ship-waiting' : ''}">
            <strong>${ship.name}</strong> ${ship.isWaiting ? '⏸️ 等待中' : '▶️ 執行中'}
            <br>
            位置: (${ship.position.x.toFixed(1)}, ${ship.position.z.toFixed(1)})
        </div>
    `).join('');
    
    // Update persons list (顯示已獲救人員，並根據 isSaved 改變樣式)
    const personsList = document.getElementById('personsList');
    personsList.innerHTML = allPersons.map(person => `
        <div class="person-item ${person.isSaved ? 'person-saved' : ''}">
            ${person.isSaved ? '✅ 已獲救' : '❌ 未找到'} ID ${person.id}
            <br>
            位置: ${person.isSaved ? `(${person.position.x.toFixed(1)}, ${person.position.z.toFixed(1)})` : '未知'}
        </div>
    `).join('');
    
    // Update wind indicator
    const windNeedle = document.getElementById('wind-needle');
    const windTheta = document.getElementById('wind-theta');
    if (windNeedle) {
        // Transformation: rotation = 90 - theta (assuming backend theta: 0°=East, 90°=North)
        const rotation = 90 - data.theta; 
        windNeedle.style.transform = `rotate(${rotation}deg)`;
        windTheta.textContent = `${data.theta.toFixed(1)}°`;
    }
    
    // Update map visualization (call function from map-renderer.js)
    if (window.updateMap) window.updateMap(data, savedPersons); // ** 只傳遞 savedPersons 給地圖 **
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Start data polling automatically
    startPolling();
});

// Expose functions globally so they can be called from index.html buttons
window.resetSimulation = resetSimulation;
window.fetchState = fetchState;
window.sendShipCommand = sendShipCommand; // Expose new command function