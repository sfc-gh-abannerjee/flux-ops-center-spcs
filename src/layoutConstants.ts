export const LAYOUT = {
  // AppBar (logo + subtitle) + Tabs 
  HEADER_HEIGHT: 140,  // AppBar ~90px + Tabs ~50px
  
  // KPI Cards (positioned relative to map container)
  KPI_TOP: 12,
  KPI_HEIGHT: 90,
  
  // Layers panel (top-right, can be expanded/tall)
  LAYERS_TOP: 12,
  LAYERS_WIDTH: 180,
  LAYERS_HEIGHT_EXPANDED: 300,  // When expanded with all toggles
  
  // Zoom/Distance indicators (bottom-left of map)
  ZOOM_BOTTOM: 20,
  ZOOM_LEFT: 20,
  ZOOM_HEIGHT: 130,
  ZOOM_WIDTH: 110,
  
  // Computed offsets for docked chat (relative to viewport/window)
  get DOCK_TOP_OFFSET_LEFT() {
    // Header + KPI cards area
    return this.HEADER_HEIGHT + this.KPI_TOP + this.KPI_HEIGHT + 16;
  },
  get DOCK_TOP_OFFSET_RIGHT() {
    // Header + Layers panel (taller than KPI cards)
    return this.HEADER_HEIGHT + this.LAYERS_TOP + this.LAYERS_HEIGHT_EXPANDED + 16;
  },
  get DOCK_BOTTOM_OFFSET() {
    return this.ZOOM_BOTTOM + this.ZOOM_HEIGHT + 16;
  },
  get DOCK_LEFT_OFFSET() {
    return this.ZOOM_LEFT + this.ZOOM_WIDTH + 16;
  },
} as const;
