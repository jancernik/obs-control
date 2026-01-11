import { OBSWebSocket } from "obs-websocket-js"

let lastNonFullscreenFilter = "top-left"

const cornerPositions = {
  "top-left": { column: 0, row: 0 },
  "top-right": { column: 1, row: 0 },
  "bottom-left": { column: 0, row: 1 },
  "bottom-right": { column: 1, row: 1 }
}

function clampGrid(value) {
  return Math.max(0, Math.min(1, value))
}

function cornerNameFromPosition(column, row) {
  if (column === 0 && row === 0) return "top-left"
  if (column === 1 && row === 0) return "top-right"
  if (column === 0 && row === 1) return "bottom-left"
  return "bottom-right"
}

function directionOffset(direction) {
  if (direction === "left") return { columnOffset: -1, rowOffset: 0 }
  if (direction === "right") return { columnOffset: 1, rowOffset: 0 }
  if (direction === "up") return { columnOffset: 0, rowOffset: -1 }
  if (direction === "down") return { columnOffset: 0, rowOffset: 1 }
  return { columnOffset: 0, rowOffset: 0 }
}

export function createObsClient({ url, password }) {
  const obs = new OBSWebSocket()

  async function connect() {
    try {
      await obs.connect(url, password)
      console.log("OBS connected")
    } catch (error) {
      console.log("OBS connection error:", error)
    }
  }

  async function ensureConnected() {
    if (!obs.identified) await connect()
  }

  function buildMoveFilterId(fs) {
    const values = [
      fs.crop.top,
      fs.crop.bottom,
      fs.crop.left,
      fs.crop.right,
      fs.pos.x,
      fs.pos.y,
      fs.scale.x,
      fs.scale.y,
      fs.rot
    ]
    return values.map((val) => val.toFixed(1).replace(/[.,]0$/, "")).join("")
  }

  function buildCurrentFilterId(it) {
    const values = [
      it.cropTop,
      it.cropBottom,
      it.cropLeft,
      it.cropRight,
      it.positionX,
      it.positionY,
      it.scaleX,
      it.scaleY,
      Number(it.rotation.toFixed(1))
    ]
    return values.map((val) => val.toFixed(1).replace(/[.,]0$/, "")).join("")
  }

  async function getMoveFilters(sourceName) {
    await ensureConnected()
    const { filters } = await obs.call("GetSourceFilterList", { sourceName })
    return filters.map((filter) => ({
      name: filter.filterName,
      id: buildMoveFilterId(filter.filterSettings),
      enabled: filter.filterEnabled
    }))
  }

  async function getCurrentFilterId(sceneName, sourceName) {
    await ensureConnected()
    const { sceneItemId } = await obs.call("GetSceneItemId", { sceneName, sourceName })
    const { sceneItemTransform } = await obs.call("GetSceneItemTransform", {
      sceneName,
      sceneItemId
    })
    return buildCurrentFilterId(sceneItemTransform)
  }

  async function setMoveFilter(filterName) {
    const moveFilters = await getMoveFilters("Camera")
    const currentId = await getCurrentFilterId("Camera", "Camera Source")
    const currentFilter = moveFilters.find((filter) => filter.id === currentId)

    if (moveFilters.some((filter) => filter.enabled)) return

    if (filterName === "fullscreen") {
      if (currentFilter.name === filterName) filterName = lastNonFullscreenFilter
    } else {
      if (currentFilter.name === filterName) return
      lastNonFullscreenFilter = filterName
    }

    await obs.call("SetSourceFilterEnabled", {
      sourceName: "Camera",
      filterName,
      filterEnabled: true
    })
  }

  async function moveRelative(direction) {
    const moveFilters = await getMoveFilters("Camera")
    const currentId = await getCurrentFilterId("Camera", "Camera Source")
    const currentFilter = moveFilters.find((filter) => filter.id === currentId)

    if (!currentFilter || currentFilter.name === "fullscreen") return
    if (moveFilters.some((filter) => filter.enabled)) return

    const currentPosition = cornerPositions[currentFilter.name]
    if (!currentPosition) return

    const offset = directionOffset(direction)
    const nextColumn = clampGrid(currentPosition.column + offset.columnOffset)
    const nextRow = clampGrid(currentPosition.row + offset.rowOffset)
    const targetFilterName = cornerNameFromPosition(nextColumn, nextRow)

    lastNonFullscreenFilter = targetFilterName

    await obs.call("SetSourceFilterEnabled", {
      sourceName: "Camera",
      filterName: targetFilterName,
      filterEnabled: true
    })
  }

  return {
    obs,
    connect,
    ensureConnected,
    getMoveFilters,
    getCurrentFilterId,
    setMoveFilter,
    moveRelative
  }
}
