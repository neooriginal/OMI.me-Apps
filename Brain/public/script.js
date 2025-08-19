// Encryption helpers
async function getKey() {
    let keyB64 = localStorage.getItem('brainKey');
    if (!keyB64) {
        const cookie = document.cookie.split('; ').find(r => r.startsWith('brainKey='));
        if (cookie) {
            keyB64 = cookie.split('=')[1];
            localStorage.setItem('brainKey', keyB64);
        }
    }
    if (!keyB64) {
        window.location.href = '/login.html';
        throw new Error('Missing Brain code');
    }
    const raw = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptText(text) {
    const key = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return `${btoa(String.fromCharCode(...iv))}:${btoa(String.fromCharCode(...new Uint8Array(cipher)))}`;
}

async function decryptText(payload) {
    try {
        const [ivB64, dataB64] = payload.split(':');
        const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
        const data = Uint8Array.from(atob(dataB64), c => c.charCodeAt(0));
        const key = await getKey();
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
        return new TextDecoder().decode(plain);
    } catch (e) {
        return payload;
    }
}

// Utility constants and functions for key management
const SUPPORT_EMAIL = 'leulices@gmail.com';

function getDeviceInfo() {
  const ua = navigator.userAgent;
  const start = ua.indexOf('(');
  const end = ua.indexOf(')');
  if (start !== -1 && end !== -1 && end > start) {
    return ua.substring(start + 1, end);
  }
  return 'Unknown';

}
// Escape HTML special characters to prevent XSS
function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


// Helper to safely escape HTML characters
function escapeHtmlSafe(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Authentication functions
async function checkAuth() {
    try {
        // Check if we have session-based authentication with the server
        const response = await fetch('/api/profile', {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('uid', data.uid);
            return data.uid;
        }

        localStorage.removeItem('uid');
        window.location.href = '/login.html';
        return null;
    } catch (error) {
        console.error('Auth check error:', error);
        window.location.href = '/login.html';
        return null;
    }
}

function logout() {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => {
        localStorage.removeItem('uid');
        window.location.href = '/login.html';
    });
}

// API call helper
async function apiCall(endpoint, options = {}) {
    try {
        const baseOptions = {
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
        };

        // Session-based authentication - no need to manually add uid
        const response = await fetch(endpoint, { ...baseOptions, ...options });
        if (response.status === 401) {
            localStorage.removeItem('uid');
            window.location.href = '/login.html';
            return null;
        }
        return response;
    } catch (error) {
        console.error('API call error:', error);
        throw error;
    }
}

// Load profile data
async function loadProfile() {
    try {
        const response = await apiCall('/api/profile');
        if (response) {
            const data = await response.json();
            document.getElementById('profile-uid').textContent = data.uid;
        }
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

// Three.js scene setup
let scene, camera, renderer, controls, composer;
let nodes = new Map();
let relationships = [];
let nodeObjects = new Map();
let lineObjects = [];
let selectedNode = null;
let distanceScale = 80;  // Reduced default distance for tighter clustering

// Initialize Three.js scene
function initScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x0a0a0f, 1);
    document.getElementById('network-container').appendChild(renderer.domElement);

    // Set up camera for brain-like view with better initial positioning for larger nodes
    camera.position.set(300, 150, 400);
    camera.lookAt(0, 0, 0);

    // Soft ambient light for overall visibility
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    // Main light from top-right
    const mainLight = new THREE.DirectionalLight(0x00ffaa, 0.6);
    mainLight.position.set(1, 1, 0.5);
    scene.add(mainLight);

    // Subtle fill light from bottom-left
    const fillLight = new THREE.DirectionalLight(0x4a9eff, 0.2);
    fillLight.position.set(-0.5, -0.5, -0.5);
    scene.add(fillLight);

    // Initialize controls for smooth interaction
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;  // More responsive damping
    controls.screenSpacePanning = true;
    controls.minDistance = 30;     // Much closer zoom for detailed node inspection
    controls.maxDistance = 1500;   // Slightly increased max distance for better overview
    controls.rotateSpeed = 0.6;    // Smoother rotation
    controls.zoomSpeed = 1.2;      // Faster zoom speed for better UX
    controls.autoRotate = false;
    controls.maxPolarAngle = Math.PI * 0.85; // Allow viewing from more angles

    // Add event listeners
    window.addEventListener('resize', onWindowResize, false);
    renderer.domElement.addEventListener('click', onNodeClick, false);

    // Add post-processing for glow effect
    initPostProcessing();
}

// Post-processing for glow effect
function initPostProcessing() {
    const renderScene = new THREE.RenderPass(scene, camera);
    const bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.8,  // Bloom intensity
        0.5,  // Bloom radius
        0.2   // Bloom threshold
    );

    // Adjust bloom parameters for neuron-like glow
    bloomPass.threshold = 0.1;   // Lower threshold for more subtle glow
    bloomPass.strength = 1.2;    // Less intense bloom
    bloomPass.radius = 0.8;      // Wider, softer glow

    composer = new THREE.EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
}

// Create node object
function createNodeObject(node) {
    const geometry = new THREE.SphereGeometry(8, 32, 32);  // Larger nodes for better visibility
    const material = new THREE.MeshPhongMaterial({
        color: getNodeColor(node.type),
        emissive: getNodeColor(node.type),
        emissiveIntensity: 0.6,  // Slightly reduced to prevent overwhelming glow
        transparent: true,
        opacity: 0.8  // Less translucent for better visibility
    });

    const sphere = new THREE.Mesh(geometry, material);

    // Add neuron pulse effect with dynamic scaling
    sphere.userData.pulsePhase = Math.random() * Math.PI * 2;  // Random starting phase
    sphere.userData.pulseSpeed = 0.003 + Math.random() * 0.002;  // Slightly random speed
    sphere.userData.baseScale = 1;
    sphere.userData.animate = () => {
        // Calculate dynamic scale based on camera distance
        const distance = camera.position.distanceTo(sphere.position);
        const minScale = 0.3;  // Minimum scale when very close
        const maxScale = 2.0;  // Maximum scale when far away
        const scaleRange = 800; // Distance range for scaling
        
        // Dynamic scale factor based on distance
        let dynamicScale = Math.min(maxScale, Math.max(minScale, distance / scaleRange));
        
        // Add pulse effect to the dynamic scale
        const pulseEffect = Math.sin(Date.now() * sphere.userData.pulseSpeed + sphere.userData.pulsePhase) * 0.08;
        const finalScale = (sphere.userData.baseScale * dynamicScale) + pulseEffect;
        
        sphere.scale.set(finalScale, finalScale, finalScale);
        
        // Also scale the label based on distance for readability
        if (sphere.children[1]) { // Label is typically the second child
            const labelScale = Math.max(0.5, Math.min(2.0, distance / 300));
            sphere.children[1].scale.set(labelScale, labelScale, labelScale);
        }
    };

    // Add glow effect
    const glowGeometry = new THREE.SphereGeometry(12, 32, 32);  // Proportionally larger glow
    const glowMaterial = new THREE.ShaderMaterial({
        uniforms: {
            color: { value: new THREE.Color(getNodeColor(node.type)) }
        },
        vertexShader: `
            varying vec3 vNormal;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 color;
            varying vec3 vNormal;
            void main() {
                float intensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
                gl_FragColor = vec4(color, intensity);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending
    });

    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    sphere.add(glow);

    // Add label with better positioning for larger nodes
    const label = new SpriteText(node.name);
    label.textHeight = 12;  // Larger text for better readability
    label.color = '#ffffff';
    label.backgroundColor = 'rgba(0, 0, 0, 0.6)';
    label.padding = 3;
    label.position.y = 16;  // Further from larger node
    sphere.add(label);

    // Store reference to original node data
    sphere.userData = node;

    return sphere;
}

// Create relationship line
function createRelationshipLine(source, target, action) {
    const points = [source.position, target.position];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    const material = new THREE.LineBasicMaterial({
        color: 0xaaaaaa,  // Neutral gray for connections
        transparent: true,
        opacity: 0.15,    // More subtle
        linewidth: 0.5    // Thinner lines
    });

    const line = new THREE.Line(geometry, material);
    line.userData = { source, target, action };

    // Add action label
    const label = new SpriteText(action);
    label.textHeight = 6;
    label.color = '#00ffaa';
    label.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    label.padding = 2;
    line.add(label);

    return line;
}

// Update visualization with new data
function updateVisualization(data) {
    // Store current data for chat context
    nodes = new Map(data.nodes.map(n => [n.id, n]));
    relationships = data.relationships.slice();

    // Clear existing objects
    nodeObjects.forEach(obj => scene.remove(obj));
    lineObjects.forEach(obj => scene.remove(obj));
    nodeObjects.clear();
    lineObjects = [];

    // Create node objects
    data.nodes.forEach(node => {
        const nodeObject = createNodeObject(node);
        nodeObjects.set(node.id, nodeObject);
        scene.add(nodeObject);
    });

    // Create relationship lines
    data.relationships.forEach(rel => {
        const sourceObj = nodeObjects.get(rel.source);
        const targetObj = nodeObjects.get(rel.target);
        if (sourceObj && targetObj) {
            const line = createRelationshipLine(sourceObj, targetObj, rel.action);
            lineObjects.push(line);
            scene.add(line);
        }
    });

    // Position nodes using force-directed layout
    updateNodePositions();
}

// Force-directed layout
function updateNodePositions() {
    const nodes = Array.from(nodeObjects.values());
    const links = lineObjects.map(line => ({
        source: line.userData.source,
        target: line.userData.target
    }));

    // Initialize nodes with golden ratio spiral distribution
    const baseRadius = 200;
    const nodesPerRing = Math.ceil(Math.sqrt(nodes.length));
    const phi = (1 + Math.sqrt(5)) / 2; // Golden ratio

    nodes.forEach((node, i) => {
        // Use golden ratio for more natural distribution
        const theta = 2 * Math.PI * i / phi;
        const progress = i / nodes.length;

        // Calculate radius with some variation
        const radius = baseRadius * Math.sqrt(progress) * (1 + (Math.random() - 0.5) * 0.2);

        // Add slight vertical offset based on radius
        const heightScale = Math.sin(progress * Math.PI);
        const height = 50 * heightScale + (Math.random() - 0.5) * 20;

        // Set position with natural spiral distribution
        node.x = radius * Math.cos(theta);
        node.y = height;
        node.z = radius * Math.sin(theta);

        // Initialize velocity for z-force
        node.vz = 0;
    });

    // Force simulation for brain-like structure
    const simulation = d3.forceSimulation(nodes)
        // Moderate repulsion between nodes
        .force('charge', d3.forceManyBody()
            .strength(-150)
            .distanceMax(200))
        // Links maintain brain structure
        .force('link', d3.forceLink(links)
            .distance(distanceScale * 0.8)
            .strength(0.2))
        // Gentle centering force
        .force('center', d3.forceCenter().strength(0.05))
        // Custom radial force for spherical arrangement
        .force('radial', d3.forceRadial(
            d => baseRadius + Math.floor(d.index / nodesPerRing) * 40,
            0, 0).strength(0.1))
        // Prevent node overlap with larger collision radius for bigger nodes
        .force('collision', d3.forceCollide().radius(25).strength(0.3))
        // Custom force for z-positioning
        .force('custom-z', alpha => {
            nodes.forEach(node => {
                // Add a small force in the z direction based on position
                const angle = Math.atan2(node.y, node.x);
                node.vz = (node.vz || 0) * 0.9 + (Math.sin(angle) * 0.1 * alpha);
                node.z += node.vz;
            });
        })
        .stop();

    // Run simulation
    for (let i = 0; i < 150; ++i) {
        simulation.tick();
    }

    // Update positions
    nodes.forEach(node => {
        node.position.set(
            node.x,
            node.y,
            node.z
        );
    });

    // Update relationship lines
    lineObjects.forEach(line => {
        const start = line.userData.source.position;
        const end = line.userData.target.position;

        // Update line geometry
        const points = [start, end];
        line.geometry.setFromPoints(points);

        // Update action label position
        if (line.children[0]) {
            line.children[0].position.set(
                (start.x + end.x) / 2,
                (start.y + end.y) / 2,
                (start.z + end.z) / 2
            );
        }
    });
}

// Handle window resize
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

// Handle node click
function onNodeClick(event) {
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(Array.from(nodeObjects.values()));

    if (intersects.length > 0) {
        const clickedNode = intersects[0].object;
        selectNode(clickedNode);
    } else {
        selectNode(null);
    }
}

// Node selection handling
function selectNode(node) {
    // Remove any existing edit modal
    const existingModal = document.getElementById('edit-node-modal');
    if (existingModal) {
        existingModal.remove();
        document.body.classList.remove('modal-open');
    }

    // Reset previous selection
    if (selectedNode) {
        // Reset previously selected node
        selectedNode.material.emissiveIntensity = 0.8;
        selectedNode.userData.baseScale = 1;

        // Reset all nodes and connections
        nodeObjects.forEach(obj => {
            obj.material.opacity = 0.7;
            obj.material.emissiveIntensity = 0.8;
        });
        lineObjects.forEach(line => {
            line.material.opacity = 0.2;
            line.children[0].visible = false;  // Hide all action labels
        });
    }

    selectedNode = node;

    if (node) {
        // Highlight selected node with enhanced visibility
        node.material.emissiveIntensity = 1.5;  // Slightly reduced to avoid overwhelming
        node.userData.baseScale = 1.8;  // Larger selection scale

        // Find and highlight connected nodes and relationships
        const connectedLines = lineObjects.filter(line =>
            line.userData.source === node ||
            line.userData.target === node
        );

        // Highlight connected nodes
        connectedLines.forEach(line => {
            const connectedNode = line.userData.source === node ?
                line.userData.target : line.userData.source;

            // Highlight connected node
            connectedNode.material.opacity = 1;
            connectedNode.material.emissiveIntensity = 1.2;

            // Highlight connection
            line.material.opacity = 0.6;
            line.children[0].visible = true;  // Show action label
        });

        // Fade non-connected nodes
        nodeObjects.forEach(obj => {
            if (obj !== node && !connectedLines.some(line =>
                line.userData.source === obj || line.userData.target === obj
            )) {
                obj.material.opacity = 0.3;
            }
        });

        // Get connected relationships
        const connections = lineObjects
            .filter(line =>
                line.userData.source === node ||
                line.userData.target === node
            )
            .map(line => ({
                node: line.userData.source === node ?
                    line.userData.target : line.userData.source,
                action: line.userData.action,
                isSource: line.userData.source === node
            }));

        // Display loading state in a new message
        const chatMessages = document.getElementById('chat-messages');
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message system';
        loadingDiv.innerHTML = `
            <div class="node-status">
                Analyzing node and its ${connections.length} connections...
            </div>
            <div class="loading-text">
                Generating insights<span class="loading-dots"></span>
            </div>
        `;
        chatMessages.appendChild(loadingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Generate node description
        apiCall('/api/generate-description', {
            method: 'POST',
            body: JSON.stringify({
                node: node.userData,
                connections: connections.slice(0, 50) // Limit connections to prevent payload size issues
            })
        })
            .then(async response => {
                if (!response.ok) {
                    throw new Error(`Server error: ${response.status}`);
                }
                try {
                    return await response.json();
                } catch (e) {
                    throw new Error('Invalid response format');
                }
            })
            .then(data => {
                // Remove loading message
                loadingDiv.remove();

                // Add new description message
                const messageDiv = document.createElement('div');
                messageDiv.className = 'message system';
                messageDiv.innerHTML = `
                <div class="node-header">
                    <strong>${node.userData.name}</strong> (${node.userData.type})
                </div>
                <div class="node-description">
                    ${data.description}
                </div>
                <div class="node-actions">
                    <button class="edit-node-btn" onclick="showEditNodeModal()">
                        <span class="icon">✏️</span> Edit Node Details
                    </button>
                </div>
            `;
                chatMessages.appendChild(messageDiv);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            })
            .catch(error => {
                console.error('Error generating description:', error);
                loadingDiv.innerHTML = `
                <div class="error-message">
                    ${error.message === 'Invalid response format' ?
                        'Server returned an invalid response. Please try again.' :
                        'Failed to generate description. Please try again.'}
                </div>
            `;
            })
            .catch(console.error);
    }
}

// Show edit node modal
function showEditNodeModal() {
    if (!selectedNode) return;

    const editModal = document.createElement('div');
    editModal.className = 'modal-overlay';
    editModal.id = 'edit-node-modal';
    editModal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Edit Node</h2>
                <button class="modal-close" onclick="closeEditModal()">✕</button>
            </div>
            <div class="modal-body">
                <div id="node-edit-controls">
                    <div class="input-group">
                        <label for="edit-node-name">Name</label>
                        <input type="text" id="edit-node-name" value="${selectedNode.userData.name}" placeholder="Node name">
                    </div>
                    <div class="input-group">
                        <label for="edit-node-type">Type</label>
                        <select id="edit-node-type">
                            ${['person', 'location', 'event', 'concept'].map(type =>
        `<option value="${type}" ${type === selectedNode.userData.type ? 'selected' : ''}>${type}</option>`
    ).join('')}
                        </select>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="action-button danger" onclick="deleteSelectedNode()">Delete Node</button>
                <button class="action-button" onclick="closeEditModal()">Cancel</button>
                <button class="action-button primary" onclick="updateSelectedNode()">Save Changes</button>
            </div>
        </div>
    `;
    document.body.appendChild(editModal);
    document.body.classList.add('modal-open');
}

// Close edit modal
function closeEditModal() {
    const modal = document.getElementById('edit-node-modal');
    if (modal) {
        modal.remove();
        document.body.classList.remove('modal-open');
    }
}

// Update selected node
async function updateSelectedNode() {
    if (!selectedNode) return;

    const nameInput = document.getElementById('edit-node-name');
    const typeSelect = document.getElementById('edit-node-type');
    const newName = nameInput.value.trim();
    const newType = typeSelect.value;

    if (!newName) {
        alert('Name cannot be empty');
        return;
    }

    try {
        const encryptedName = await encryptText(newName);
        const encryptedType = await encryptText(newType);
        const response = await apiCall(`/api/node/${selectedNode.userData.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                name: encryptedName,
                type: encryptedType
            })
        });

        if (response.ok) {
            const encrypted = await response.json();
            const decrypted = {
                nodes: await Promise.all(encrypted.nodes.map(async n => ({
                    id: n.id,
                    type: await decryptText(n.type),
                    name: await decryptText(n.name),
                    connections: n.connections
                }))),
                relationships: await Promise.all(encrypted.relationships.map(async r => ({
                    source: r.source,
                    target: r.target,
                    action: await decryptText(r.action)
                })))
            };
            updateVisualization(decrypted);
            closeEditModal();
            const updatedNode = nodeObjects.get(selectedNode.userData.id);
            if (updatedNode) {
                selectNode(updatedNode);
            }
        }
    } catch (error) {
        console.error('Error updating node:', error);
        alert('Failed to update node');
    }
}

// Delete selected node
async function deleteSelectedNode() {
    if (!selectedNode || !confirm('Are you sure you want to delete this node and all its relationships?')) return;

    try {
        const response = await apiCall(`/api/node/${selectedNode.userData.id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            const encrypted = await response.json();
            const decrypted = {
                nodes: await Promise.all(encrypted.nodes.map(async n => ({
                    id: n.id,
                    type: await decryptText(n.type),
                    name: await decryptText(n.name),
                    connections: n.connections
                }))),
                relationships: await Promise.all(encrypted.relationships.map(async r => ({
                    source: r.source,
                    target: r.target,
                    action: await decryptText(r.action)
                })))
            };
            updateVisualization(decrypted);
            closeEditModal();
            selectNode(null); // Deselect node
        }
    } catch (error) {
        console.error('Error deleting node:', error);
        alert('Failed to delete node');
    }
}

// Data deletion functions
function showDeleteConfirmation() {
    document.getElementById('delete-modal').style.display = 'flex';
    document.body.classList.add('modal-open');
}

function hideDeleteConfirmation() {
    document.getElementById('delete-modal').style.display = 'none';
    document.body.classList.remove('modal-open');
}

async function deleteAllData() {
    const uid = checkAuth();
    if (!uid) return;

    try {
        // Disable the delete button and show loading state
        const deleteBtn = document.querySelector('.modal-footer .action-button.danger');
        const originalText = deleteBtn.innerHTML;
        deleteBtn.disabled = true;
        deleteBtn.innerHTML = '<span class="icon">⏳</span> Deleting...';

        const response = await apiCall('/api/delete-all-data', {
            method: 'POST'
        });

        if (response && response.ok) {
            // Show success message
            const modalBody = document.querySelector('.modal-body');
            modalBody.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <span style="font-size: 48px; margin-bottom: 16px; display: block;">✅</span>
                    <p style="font-size: 18px; margin-bottom: 16px;">Your data has been successfully deleted.</p>
                    <p>You will be redirected to the login page in a few seconds...</p>
                </div>
            `;

            // Hide the footer buttons
            document.querySelector('.modal-footer').style.display = 'none';

            // Clear local storage and redirect after a delay
            setTimeout(() => {
                localStorage.clear();
                window.location.href = '/login.html?deleted=true';
            }, 3000);
        } else {
            throw new Error('Failed to delete data');
        }
    } catch (error) {
        console.error('Error deleting data:', error);

        // Show error message in the modal
        const modalBody = document.querySelector('.modal-body');
        modalBody.innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <span style="font-size: 48px; margin-bottom: 16px; display: block; color: #ff3b30;">❌</span>
                <p style="font-size: 18px; margin-bottom: 16px; color: #ff3b30;">Failed to delete data</p>
                <p>Please try again later or contact support if the problem persists.</p>
            </div>
        `;

        // Update footer buttons
        const footer = document.querySelector('.modal-footer');
        footer.innerHTML = `
            <button class="action-button" onclick="hideDeleteConfirmation()">Close</button>
            <button class="action-button danger" onclick="deleteAllData()">Try Again</button>
        `;
    }
}

// Get color based on node type
function getNodeColor(type) {
    // Distinct, vibrant colors for each type
    const colors = {
        person: 0xff4d4d,    // Bright red for people
        location: 0x4ecdc4,  // Turquoise for locations
        event: 0xffd93d,     // Bright yellow for events
        concept: 0xa78bfa    // Purple for concepts
    };
    return colors[type] || 0x4a9eff;
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();

    // Update all node animations
    nodeObjects.forEach(node => {
        if (node.userData.animate) {
            node.userData.animate();
        }
    });

    composer.render();
}

// Export loadMemoryGraph function for use in other pages
async function loadMemoryGraph() {
    try {
        const response = await apiCall('/api/memory-graph');
        if (response && response.ok) {
            const data = await response.json();
            if (data) {
                const decrypted = {
                    nodes: await Promise.all(data.nodes.map(async n => ({
                        id: n.id,
                        type: await decryptText(n.type),
                        name: await decryptText(n.name),
                        connections: n.connections
                    }))),
                    relationships: await Promise.all(data.relationships.map(async r => ({
                        source: r.source,
                        target: r.target,
                        action: await decryptText(r.action)
                    })))
                };
                updateVisualization(decrypted);
                return decrypted;
            }
        }
    } catch (error) {
        console.error('Error loading memory graph:', error);
    }
    return null;
}

// Make functions globally available for other scripts
window.initScene = initScene;
window.loadMemoryGraph = loadMemoryGraph;

// Auto-expanding textarea functionality
function setupAutoExpandingTextarea() {
    const chatInput = document.getElementById('chat-input');
    if (!chatInput) return;
    
    // Auto-expand on input
    chatInput.addEventListener('input', function() {
        // Reset height to auto to get the correct scrollHeight
        this.style.height = 'auto';
        
        // Set height based on content, with min and max limits
        const newHeight = Math.min(Math.max(this.scrollHeight, 45), 120);
        this.style.height = newHeight + 'px';
    });
    
    // Reset height after sending message
    chatInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            setTimeout(() => {
                this.style.height = '45px';
            }, 100);
        }
    });
}

// Initialize everything when the document is loaded
document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication with server
    const uid = await checkAuth();
    if (!uid) {
        return; // checkAuth will redirect to login if needed
    }

    // Clean URL of any uid parameter
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('uid')) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    initScene();
    animate();
    
    // Initialize auto-expanding textarea
    setupAutoExpandingTextarea();

    // Initialize upload functionality
    const processTextBtn = document.getElementById('process-text');
    const textUpload = document.getElementById('text-upload');
    const uploadStatus = document.getElementById('upload-status');

    // Initialize text processing
    if (processTextBtn && textUpload) {
        processTextBtn.addEventListener('click', async () => {
            const text = textUpload.value.trim();
            if (!text) return;

            // Disable button and show processing state
            processTextBtn.disabled = true;
            const originalText = processTextBtn.innerHTML;
            processTextBtn.innerHTML = '<span class="icon">⏳</span> Processing...';

            // Show processing status
            uploadStatus.innerHTML = `
                <div class="loading-text">
                    Processing text and updating memory graph<span class="loading-dots"></span>
                </div>
            `;
            uploadStatus.classList.add('active');

            try {
                const response = await apiCall(`/api/process-text`, {
                    method: 'POST',
                    body: JSON.stringify({
                        transcript_segments: [{ speaker: 'User', text }]
                    })
                });

                if (response.ok) {
                    const processed = await response.json();
                    const processedData = {
                        nodes: processed.entities.map(e => ({ id: e.id, type: e.type, name: e.name, connections: e.connections || 0 })),
                        relationships: processed.relationships.map(r => ({ source: r.source, target: r.target, action: r.action }))
                    };
                    const encryptedPayload = {
                        entities: await Promise.all(processed.entities.map(async e => ({
                            id: e.id,
                            type: await encryptText(e.type),
                            name: await encryptText(e.name),
                            connections: e.connections || 0
                        }))),
                        relationships: await Promise.all(processed.relationships.map(async r => ({
                            source: r.source,
                            target: r.target,
                            action: await encryptText(r.action)
                        })))
                    };
                    await apiCall('/api/memory-graph', {
                        method: 'POST',
                        body: JSON.stringify(encryptedPayload)
                    });
                    
                    // After processing, reload the complete memory graph to show all nodes
                    await loadMemoryGraph();

                    textUpload.value = '';
                    uploadStatus.innerHTML = `
                        <div class="success">
                            <span class="icon">✓</span>
                            Text processed successfully
                        </div>
                        <div class="stats">
                            Added ${processedData.nodes.length} nodes and ${processedData.relationships.length} connections to your memory graph
                        </div>
                    `;
                }
            } catch (error) {
                console.error('Error processing text:', error);
                uploadStatus.innerHTML = `
                    <div class="error">
                        <span class="icon">❌</span>
                        Failed to process text. Please try again.
                    </div>
                `;
            } finally {
                // Reset button state
                processTextBtn.disabled = false;
                processTextBtn.innerHTML = originalText;
            }
        });
    }

    // Initialize chat functionality
    const chatSendBtn = document.getElementById('chat-send');
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');

    if (chatSendBtn && chatInput) {
        chatSendBtn.addEventListener('click', async () => {
            const message = chatInput.value.trim();
            if (!message) return;

            // Add user message to chat
            const userMessageDiv = document.createElement('div');
            userMessageDiv.className = 'message user';
            userMessageDiv.textContent = message;
            chatMessages.appendChild(userMessageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;

            // Clear input
            chatInput.value = '';

            try {
                const context = {
                    nodes: Array.from(nodes.values()),
                    relationships
                };
                const key = localStorage.getItem('brainKey');
                const response = await apiCall('/api/chat', {
                    method: 'POST',
                    body: JSON.stringify({ message, context, key })
                });
                if (response) {
                    const data = await response.json();

                    const aiMessageDiv = document.createElement('div');
                    aiMessageDiv.className = 'message ai';
                    aiMessageDiv.textContent = data.response;
                    chatMessages.appendChild(aiMessageDiv);
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
            } catch (error) {
                console.error('Chat error:', error);
                // Show error message in chat
                const errorDiv = document.createElement('div');
                errorDiv.className = 'message error';
                errorDiv.textContent = 'Sorry, there was an error processing your message.';
                chatMessages.appendChild(errorDiv);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        });

        // Handle enter key for chat
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                chatSendBtn.click();
            }
        });
    }

    // Initialize search functionality
    const searchBtn = document.getElementById('search-btn');
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');

    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', () => {
            const query = searchInput.value.trim();
            if (!query) return;

            // Clear previous results
            searchResults.innerHTML = '';

            // Get all nodes that match the search
            const matchingNodes = Array.from(nodeObjects.values())
                .filter(node =>
                    node.userData.name.toLowerCase().includes(query.toLowerCase()) ||
                    node.userData.type.toLowerCase().includes(query.toLowerCase())
                );

            if (matchingNodes.length > 0) {
                matchingNodes.forEach(node => {
                    // Find connected nodes and relationships
                    const connections = lineObjects
                        .filter(line =>
                            line.userData.source === node ||
                            line.userData.target === node
                        )
                        .map(line => ({
                            node: line.userData.source === node ?
                                line.userData.target : line.userData.source,
                            action: line.userData.action,
                            isSource: line.userData.source === node
                        }));

                    const resultDiv = document.createElement('div');
                    resultDiv.className = 'search-result';
                    resultDiv.innerHTML = `
                        <div class="result-header">
                            <div class="result-type">${node.userData.type}</div>
                            <div class="result-name">${node.userData.name}</div>
                        </div>
                        <div class="result-connections">
                            ${connections.length ? `
                                <div class="connections-count">${connections.length} connections:</div>
                                <div class="connections-list">
                                    ${connections.slice(0, 3).map(conn =>
                        `<div class="connection">
                                            ${conn.isSource ? '→' : '←'} ${conn.action} ${conn.node.userData.name}
                                        </div>`
                    ).join('')}
                                    ${connections.length > 3 ? `<div class="more-connections">+${connections.length - 3} more...</div>` : ''}
                                </div>
                            ` : '<div class="no-connections">No connections</div>'}
                        </div>
                    `;

                    // Click handler to focus on node
                    resultDiv.addEventListener('click', () => {
                        // Smooth camera transition with optimal distance for larger nodes
                        const nodePos = node.position;
                        const distance = 100;  // Closer distance for better view of larger nodes
                        const targetPos = new THREE.Vector3(
                            nodePos.x + distance,
                            nodePos.y + distance,
                            nodePos.z + distance
                        );

                        // Animate camera movement
                        const startPos = camera.position.clone();
                        const startLook = controls.target.clone();
                        const endLook = nodePos.clone();

                        const duration = 1000;  // 1 second
                        const startTime = Date.now();

                        function animateCamera() {
                            const elapsed = Date.now() - startTime;
                            const progress = Math.min(elapsed / duration, 1);

                            // Smooth easing
                            const ease = progress < 0.5 ?
                                2 * progress * progress :
                                -1 + (4 - 2 * progress) * progress;

                            camera.position.lerpVectors(startPos, targetPos, ease);
                            controls.target.lerpVectors(startLook, endLook, ease);
                            controls.update();

                            if (progress < 1) {
                                requestAnimationFrame(animateCamera);
                            } else {
                                // Select the node after camera movement
                                selectNode(node);
                            }
                        }

                        animateCamera();
                    });

                    searchResults.appendChild(resultDiv);
                });
            } else {
                searchResults.innerHTML = '<div class="no-results">No matching nodes found</div>';
            }
        });

        // Handle enter key for search
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchBtn.click();
            }
        });
    }

    // Initialize tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const tab = btn.dataset.tab;
            document.getElementById(`${tab}-tab`).classList.add('active');

            if (tab === 'profile') {
                loadProfile();
            }
        });
    });

    // Load initial memory graph
    loadMemoryGraph();

    // Initialize mobile UI toggle
    const mobileToggle = document.getElementById('mobile-toggle');
    const uiContainer = document.getElementById('ui-container');
    const menuOverlay = document.getElementById('menu-overlay');

    if (mobileToggle && uiContainer && menuOverlay) {
        // Remove any existing event listeners
        const newMobileToggle = mobileToggle.cloneNode(true);
        mobileToggle.parentNode.replaceChild(newMobileToggle, mobileToggle);

        const newMenuOverlay = menuOverlay.cloneNode(true);
        menuOverlay.parentNode.replaceChild(newMenuOverlay, menuOverlay);

        // Add new event listeners with better feedback
        newMobileToggle.addEventListener('click', () => {
            console.log('Mobile toggle clicked');
            const isActive = uiContainer.classList.toggle('active');
            newMenuOverlay.classList.toggle('active');
            newMobileToggle.classList.toggle('active');
            
            // Update aria attributes for accessibility
            newMobileToggle.setAttribute('aria-expanded', isActive);
            newMobileToggle.setAttribute('aria-label', isActive ? 'Close menu' : 'Open menu');
        });

        newMenuOverlay.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                uiContainer.classList.remove('active');
                newMenuOverlay.classList.remove('active');
                newMobileToggle.classList.remove('active');
            }
        });
    }
    
    // Enterprise-grade key management functions
    async function exportEncryptionKey() {
        try {
            const key = localStorage.getItem('brainKey');
            if (!key) {
                await Swal.fire({
                    title: 'No Key Found',
                    text: 'No encryption key found on this device.',
                    icon: 'warning',
                    confirmButtonColor: '#00ffaa'
                });
                return;
            }
            
            // Create a formatted text file with instructions
            const timestamp = new Date().toISOString().split('T')[0];
            const uid = document.getElementById('profile-uid').textContent || 'unknown';
            const content = `BRAIN ENCRYPTION KEY BACKUP
================================
Generated: ${new Date().toLocaleString()}
User ID: ${uid}
Device: ${getDeviceInfo()}

YOUR ENCRYPTION KEY:
${key}

IMPORTANT SECURITY INFORMATION:
-------------------------------
• This key encrypts all your Brain app data
• Store this file in a secure location (password manager recommended)
• Never share this key with anyone
• You'll need this key to access your data on other devices
• If you lose this key, your data cannot be recovered

HOW TO USE THIS KEY:
--------------------
1. When logging in from a new device, you'll be prompted for this key
2. Copy the key from this file (the long string above)
3. Paste it when prompted during login
4. The key will be securely stored on that device

BEST PRACTICES:
---------------
• Store in a password manager (1Password, Bitwarden, etc.)
• Keep a backup in a secure cloud storage
• Consider printing and storing in a safe
• Delete this file from Downloads after securing it

For support: ${SUPPORT_EMAIL}
`;
            
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `brain-key-backup-${timestamp}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            await Swal.fire({
                title: 'Key Downloaded Successfully',
                html: `
                    <div style="text-align: left;">
                        <p>Your encryption key has been saved to:</p>
                        <code style="background: rgba(0,0,0,0.2); padding: 5px; border-radius: 4px;">
                            brain-key-backup-${timestamp}.txt
                        </code>
                        <br><br>
                        <strong style="color: #ffc107;">⚠️ Next Steps:</strong>
                        <ol style="margin: 10px 0; padding-left: 20px;">
                            <li>Store this file in your password manager</li>
                            <li>Delete it from your Downloads folder</li>
                            <li>Never share this key with anyone</li>
                        </ol>
                    </div>
                `,
                icon: 'success',
                confirmButtonColor: '#00ffaa'
            });
        } catch (error) {
            console.error('Export error:', error);
            Swal.fire({
                title: 'Export Failed',
                text: 'Unable to export encryption key. Please try copying it instead.',
                icon: 'error',
                confirmButtonColor: '#ff1493'
            });
        }
    }
    
    async function copyEncryptionKey() {
        try {
            const key = localStorage.getItem('brainKey');
            if (!key) {
                await Swal.fire({
                    title: 'No Key Found',
                    text: 'No encryption key found on this device.',
                    icon: 'warning',
                    confirmButtonColor: '#00ffaa'
                });
                return;
            }
            
            // Try modern clipboard API first
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(key);
            } else {
                // Fallback for older browsers
                const textarea = document.createElement('textarea');
                textarea.value = key;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            
            await Swal.fire({
                title: 'Key Copied!',
                html: `
                    <div style="text-align: center;">
                        <p>Your encryption key has been copied to the clipboard.</p>
                        <br>
                        <strong style="color: #ffc107;">⚠️ Security Tips:</strong>
                        <ul style="text-align: left; margin: 10px auto; max-width: 300px;">
                            <li>Paste it immediately into your password manager</li>
                            <li>Don't paste it in unsecured locations</li>
                            <li>Clear your clipboard after use</li>
                        </ul>
                    </div>
                `,
                icon: 'success',
                timer: 5000,
                timerProgressBar: true,
                confirmButtonColor: '#00ffaa'
            });
        } catch (error) {
            console.error('Copy error:', error);
            // Show manual copy dialog
            const key = localStorage.getItem('brainKey');
            await Swal.fire({
                title: 'Manual Copy Required',
                html: `
                    <div>
                        <p>Select and copy your key:</p>
                        <input type="text" 
                               value="${key}" 
                               readonly 
                               style="width: 100%; padding: 10px; margin: 10px 0; background: rgba(0,0,0,0.2); border: 1px solid rgba(0,255,170,0.3); border-radius: 4px; color: #00ffaa; font-family: monospace; font-size: 12px;"
                               onclick="this.select()">
                    </div>
                `,
                confirmButtonColor: '#00ffaa'
            });
        }
    }
    
    async function showKeyInstructions() {
        await Swal.fire({
            title: '🔐 How to Manage Your Encryption Key',
            html: `
                <div style="text-align: left; max-height: 400px; overflow-y: auto;">
                    <h4 style="color: #00ffaa; margin-top: 20px;">What is this key?</h4>
                    <p>Your encryption key is a unique code that protects all your Brain app data using AES-256 encryption, the same standard used by banks and governments.</p>
                    
                    <h4 style="color: #00ffaa; margin-top: 20px;">Why is it important?</h4>
                    <ul>
                        <li>It's the only way to decrypt your data</li>
                        <li>Without it, your data is permanently inaccessible</li>
                        <li>Not even we can recover it if lost</li>
                    </ul>
                    
                    <h4 style="color: #00ffaa; margin-top: 20px;">How to store it safely:</h4>
                    <ol>
                        <li><strong>Password Manager</strong> (Recommended)
                            <br>Store it in 1Password, Bitwarden, LastPass, etc.</li>
                        <li><strong>Secure Cloud Storage</strong>
                            <br>Save in an encrypted folder in your cloud drive</li>
                        <li><strong>Physical Backup</strong>
                            <br>Print and store in a safe or safety deposit box</li>
                    </ol>
                    
                    <h4 style="color: #00ffaa; margin-top: 20px;">Using on other devices:</h4>
                    <ol>
                        <li>Login with your UID on the new device</li>
                        <li>When prompted, enter your encryption key</li>
                        <li>The key will be securely saved on that device</li>
                    </ol>
                    
                    <h4 style="color: #ff1493; margin-top: 20px;">⚠️ Never:</h4>
                    <ul>
                        <li>Share your key with anyone</li>
                        <li>Store it in plain text emails</li>
                        <li>Save it in unencrypted notes apps</li>
                        <li>Post it on social media or forums</li>
                    </ul>
                </div>
            `,
            confirmButtonText: 'Got it!',
            confirmButtonColor: '#00ffaa',
            width: '600px'
        });
    }
    
    // Make functions globally available
    window.exportEncryptionKey = exportEncryptionKey;
    window.copyEncryptionKey = copyEncryptionKey;
    window.showKeyInstructions = showKeyInstructions;
});
