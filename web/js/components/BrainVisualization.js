/**
 * SoulEngine Brain Visualization
 * Neural network with Brownian motion, mouse interaction, and pillar colors
 */

export class BrainVisualization {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) return;
    
    this.nodes = [];
    this.edges = [];
    this.animationId = null;
    this.mousePos = { x: null, y: null };
    this.activeNodeIndex = 0;
    this.lastColorChange = Date.now();
    this.colorChangeInterval = 7000;
    this.targetPillarColor = null;
    this.colorTransitionProgress = 1;
    
    // Mouse interaction state
    this.isMouseActive = false;
    this.cursorHeldNodeIndex = -1;
    
    // Pillar colors (RGB)
    this.pillarColors = {
      core: { r: 245, g: 165, b: 184 },    // Pink
      daily: { r: 245, g: 194, b: 122 },   // Orange
      weekly: { r: 245, g: 226, b: 122 },  // Yellow
      persona: { r: 122, g: 224, b: 196 }, // Teal
      mcp: { r: 196, g: 165, b: 245 }      // Purple
    };
    
    // Default: off-white for nodes, grey for edges
    this.baseColor = { r: 220, g: 220, b: 215 };
    this.edgeColor = { r: 120, g: 120, b: 115 };
    
    this.config = {
      nodeCount: 14,
      baseOpacity: 0.35,
      activeOpacity: 1.0,
      neighborOpacity: 0.85,
      edgeBaseOpacity: 0.15,
      edgeActiveOpacity: 0.9,
      connectionDistance: 150,
      brownianForce: 0.4,
      mouseInfluenceRadius: 120,
      mouseAttractionForce: 0.08,
      nodeRadius: 6,
      activeGlowRadius: 45,
      neighborGlowRadius: 25,
      glowIntensity: 0.7
    };
    
    this.init();
  }
  
  init() {
    requestAnimationFrame(() => {
      this.setupCanvas();
      this.createNodes();
      this.bindEvents();
      this.animate();
    });
  }
  
  setupCanvas() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    this.width = rect.width > 0 ? rect.width : 500;
    this.height = rect.height > 0 ? rect.height : 500;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);

    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
    this.radius = Math.min(this.width, this.height) * 0.4;
  }
  
  createNodes() {
    this.nodes = [];
    
    // Hardcoded node positions as ratios (0-1) of the container
    // These form a brain-like network shape
    const nodePositions = [
      // Inner cluster (core brain)
      { rx: 0.5, ry: 0.35 },   // Top center
      { rx: 0.4, ry: 0.45 },   // Upper left
      { rx: 0.6, ry: 0.45 },   // Upper right
      { rx: 0.35, ry: 0.55 },  // Mid left
      { rx: 0.5, ry: 0.5 },    // Center
      { rx: 0.65, ry: 0.55 },  // Mid right
      { rx: 0.45, ry: 0.65 },  // Lower left
      { rx: 0.55, ry: 0.65 },  // Lower right
      
      // Perimeter nodes (brain outline)
      { rx: 0.5, ry: 0.2 },    // Top
      { rx: 0.25, ry: 0.35 },  // Upper far left
      { rx: 0.75, ry: 0.35 },  // Upper far right
      { rx: 0.2, ry: 0.55 },   // Far left
      { rx: 0.8, ry: 0.55 },   // Far right
      { rx: 0.3, ry: 0.75 },   // Lower left
      { rx: 0.7, ry: 0.75 },   // Lower right
      { rx: 0.5, ry: 0.8 },    // Bottom center
    ];
    
    nodePositions.forEach((pos, i) => {
      // Add some randomness to avoid perfect symmetry
      const jitterX = (Math.random() - 0.5) * 20;
      const jitterY = (Math.random() - 0.5) * 20;
      
      const x = pos.rx * this.width + jitterX;
      const y = pos.ry * this.height + jitterY;
      
      this.nodes.push({
        x: x,
        y: y,
        baseX: x,
        baseY: y,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        radius: this.config.nodeRadius + Math.random() * 3,
        isPerimeter: i >= 8
      });
    });

    this.buildEdges();
  }
  
  buildEdges() {
    this.edges = [];
    
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const dx = this.nodes[i].x - this.nodes[j].x;
        const dy = this.nodes[i].y - this.nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < this.config.connectionDistance) {
          this.edges.push({ from: i, to: j, distance: dist });
        }
      }
    }
  }
  
  bindEvents() {
    window.addEventListener('resize', () => {
      this.setupCanvas();
      this.createNodes();
    });
    
    // Mouse move
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mousePos.x = e.clientX - rect.left;
      this.mousePos.y = e.clientY - rect.top;
      this.isMouseActive = true;
    });
    
    this.canvas.addEventListener('mouseleave', () => {
      this.mousePos.x = null;
      this.mousePos.y = null;
      this.isMouseActive = false;
      this.cursorHeldNodeIndex = -1;
    });
    
    // Touch support
    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) {
        const rect = this.canvas.getBoundingClientRect();
        this.mousePos.x = e.touches[0].clientX - rect.left;
        this.mousePos.y = e.touches[0].clientY - rect.top;
        this.isMouseActive = true;
      }
    });
    
    this.canvas.addEventListener('touchend', () => {
      this.mousePos.x = null;
      this.mousePos.y = null;
      this.isMouseActive = false;
      this.cursorHeldNodeIndex = -1;
    });
  }
  
  setPillarColor(pillarName) {
    if (this.pillarColors[pillarName]) {
      this.targetPillarColor = this.pillarColors[pillarName];
      this.colorTransitionProgress = 0;
    }
  }
  
  clearPillarColor() {
    this.targetPillarColor = null;
    this.colorTransitionProgress = 0;
  }
  
  updateActiveNode() {
    // Only update random active node when mouse is not active
    if (!this.isMouseActive) {
      const now = Date.now();
      if (now - this.lastColorChange > this.colorChangeInterval) {
        this.activeNodeIndex = Math.floor(Math.random() * this.nodes.length);
        this.lastColorChange = now;
        this.colorChangeInterval = 6000 + Math.random() * 4000;
      }
    }
  }
  
  findClosestNodeToMouse() {
    if (this.mousePos.x === null || this.mousePos.y === null) {
      return -1;
    }
    
    let closestIndex = -1;
    let closestDist = Infinity;
    
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const dx = node.x - this.mousePos.x;
      const dy = node.y - this.mousePos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < closestDist) {
        closestDist = dist;
        closestIndex = i;
      }
    }
    
    return closestIndex;
  }
  
  getActiveColor() {
    if (this.colorTransitionProgress < 1) {
      this.colorTransitionProgress += 0.03;
    }
    
    if (this.targetPillarColor) {
      const t = Math.min(1, this.colorTransitionProgress);
      return {
        r: Math.round(this.baseColor.r + (this.targetPillarColor.r - this.baseColor.r) * t),
        g: Math.round(this.baseColor.g + (this.targetPillarColor.g - this.baseColor.g) * t),
        b: Math.round(this.baseColor.b + (this.targetPillarColor.b - this.baseColor.b) * t)
      };
    }
    
    return this.baseColor;
  }
  
  getNeighbors(nodeIndex) {
    const neighbors = new Set();
    for (const edge of this.edges) {
      if (edge.from === nodeIndex) neighbors.add(edge.to);
      if (edge.to === nodeIndex) neighbors.add(edge.from);
    }
    return neighbors;
  }
  
  update() {
    this.updateActiveNode();
    
    // Find closest node to cursor for attraction
    this.cursorHeldNodeIndex = this.findClosestNodeToMouse();
    
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      
      // Brownian motion
      node.vx += (Math.random() - 0.5) * this.config.brownianForce;
      node.vy += (Math.random() - 0.5) * this.config.brownianForce;
      
      // Mouse ATTRACTION - only for the closest node
      if (this.mousePos.x !== null && i === this.cursorHeldNodeIndex) {
        const dx = this.mousePos.x - node.x;
        const dy = this.mousePos.y - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > 5) { // Prevent collapse when very close
          // Attract toward cursor
          node.vx += (dx / dist) * this.config.mouseAttractionForce * Math.min(dist, 100);
          node.vy += (dy / dist) * this.config.mouseAttractionForce * Math.min(dist, 100);
        }
      }
      
      // Spring back to base position (soft constraint)
      const homeX = node.baseX - node.x;
      const homeY = node.baseY - node.y;
      node.vx += homeX * 0.01;
      node.vy += homeY * 0.01;
      
      // Damping
      node.vx *= 0.95;
      node.vy *= 0.95;
      
      // Apply velocity
      node.x += node.vx;
      node.y += node.vy;
      
      // Keep within bounds (soft)
      const margin = 20;
      if (node.x < margin) node.vx += 0.5;
      if (node.x > this.width - margin) node.vx -= 0.5;
      if (node.y < margin) node.vy += 0.5;
      if (node.y > this.height - margin) node.vy -= 0.5;
    }
    
    // Rebuild edges periodically (nodes move)
    this.buildEdges();
  }
  
  draw() {
    const ctx = this.ctx;
    
    // Clear canvas
    ctx.clearRect(0, 0, this.width, this.height);
    
    const activeColor = this.getActiveColor();
    
    // Determine which node is "active" for brightness
    // When mouse is active: use cursor-held node
    // When mouse is inactive: use random cycling node
    const effectiveActiveIndex = this.isMouseActive ? this.cursorHeldNodeIndex : this.activeNodeIndex;
    const neighbors = this.getNeighbors(effectiveActiveIndex);
    
    // Draw edges first (behind nodes)
    for (const edge of this.edges) {
      const fromNode = this.nodes[edge.from];
      const toNode = this.nodes[edge.to];
      
      const isActiveEdge = edge.from === effectiveActiveIndex || edge.to === effectiveActiveIndex;
      const distFactor = 1 - (edge.distance / this.config.connectionDistance);
      
      let opacity = this.config.edgeBaseOpacity * distFactor;
      let color = this.edgeColor;
      let lineWidth = 1;

      if (isActiveEdge) {
        opacity = this.config.edgeActiveOpacity * distFactor;
        color = activeColor;
        lineWidth = 2;
      }
      
      ctx.beginPath();
      ctx.moveTo(fromNode.x, fromNode.y);
      ctx.lineTo(toNode.x, toNode.y);
      ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${opacity})`;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
    
    // Draw nodes
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const isActive = i === effectiveActiveIndex;
      const isNeighbor = neighbors.has(i);
      
      let opacity = this.config.baseOpacity;
      let color = this.baseColor;
      let glowRadius = 0;
      let nodeScale = 1;
      
      if (isActive) {
        opacity = this.config.activeOpacity;
        color = activeColor;
        glowRadius = this.config.activeGlowRadius;
        nodeScale = 1.4;
      } else if (isNeighbor) {
        opacity = this.config.neighborOpacity;
        color = activeColor;
        glowRadius = this.config.neighborGlowRadius;
        nodeScale = 1.15;
      }
      
      // Draw multi-layer glow for intense effect
      if (glowRadius > 0) {
        // Outer soft glow
        const outerGlow = ctx.createRadialGradient(
          node.x, node.y, 0,
          node.x, node.y, glowRadius * 1.5
        );
        outerGlow.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${this.config.glowIntensity * 0.3})`);
        outerGlow.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${this.config.glowIntensity * 0.1})`);
        outerGlow.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
        
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowRadius * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = outerGlow;
        ctx.fill();
        
        // Middle glow
        const midGlow = ctx.createRadialGradient(
          node.x, node.y, 0,
          node.x, node.y, glowRadius
        );
        midGlow.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${this.config.glowIntensity * 0.5})`);
        midGlow.addColorStop(0.6, `rgba(${color.r}, ${color.g}, ${color.b}, ${this.config.glowIntensity * 0.2})`);
        midGlow.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
        
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = midGlow;
        ctx.fill();
        
        // Inner bright core
        const innerGlow = ctx.createRadialGradient(
          node.x, node.y, 0,
          node.x, node.y, glowRadius * 0.5
        );
        innerGlow.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${this.config.glowIntensity})`);
        innerGlow.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
        
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowRadius * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = innerGlow;
        ctx.fill();
      }
      
      // Draw node (scaled for active/neighbor)
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius * nodeScale, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${opacity})`;
      ctx.fill();
    }
  }
  
  animate() {
    this.update();
    this.draw();
    this.animationId = requestAnimationFrame(() => this.animate());
  }
  
  destroy() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
}

export default BrainVisualization;