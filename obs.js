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
    return values.map((val) => val.toFixed(1).replace(/[.,]0$/, "")).join(",")
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
    return values.map((val) => val.toFixed(1).replace(/[.,]0$/, "")).join(",")
  }

  function filterPosition(id) {
    const parts = id.split(",").map(Number)
    return { x: parts[4], y: parts[5] }
  }

  function findCurrentFilter(filters, currentId) {
    const { x: cx, y: cy } = filterPosition(currentId)
    return filters.reduce((best, filter) => {
      const { x: fx, y: fy } = filterPosition(filter.id)
      const d = Math.hypot(cx - fx, cy - fy)
      const bestD = best
        ? Math.hypot(cx - filterPosition(best.id).x, cy - filterPosition(best.id).y)
        : Infinity
      return d < bestD ? filter : best
    }, null)
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
    const currentFilter = findCurrentFilter(moveFilters, currentId)

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
    const currentFilter = findCurrentFilter(moveFilters, currentId)

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

  async function getSceneAndSourceInfo() {
    const { baseWidth: sceneWidth, baseHeight: sceneHeight } = await obs.call("GetVideoSettings")
    const { sceneItems } = await obs.call("GetSceneItemList", { sceneName: "Camera" })
    const cameraItem = sceneItems.find((i) => i.sourceName === "Camera Source")
    return {
      sceneWidth,
      sceneHeight,
      sourceWidth: cameraItem.sceneItemTransform.sourceWidth,
      sourceHeight: cameraItem.sceneItemTransform.sourceHeight
    }
  }

  async function getCameraSpacing() {
    await ensureConnected()
    const { sceneWidth, sceneHeight, sourceWidth, sourceHeight } = await getSceneAndSourceInfo()
    const { filters } = await obs.call("GetSourceFilterList", { sourceName: "Camera" })

    const topLeftSettings = filters.find((f) => f.filterName === "top-left")?.filterSettings
    const bottomRightSettings = filters.find((f) => f.filterName === "bottom-right")?.filterSettings

    const left = Math.round(topLeftSettings?.pos?.x ?? 0)
    const top = Math.round(topLeftSettings?.pos?.y ?? 0)

    const bottomRightDisplayedWidth =
      (sourceWidth -
        (bottomRightSettings?.crop?.left ?? 0) -
        (bottomRightSettings?.crop?.right ?? 0)) *
      (bottomRightSettings?.scale?.x ?? 1)
    const bottomRightDisplayedHeight =
      (sourceHeight -
        (bottomRightSettings?.crop?.top ?? 0) -
        (bottomRightSettings?.crop?.bottom ?? 0)) *
      (bottomRightSettings?.scale?.y ?? 1)
    const right = Math.round(
      sceneWidth - (bottomRightSettings?.pos?.x ?? 0) - bottomRightDisplayedWidth
    )
    const bottom = Math.round(
      sceneHeight - (bottomRightSettings?.pos?.y ?? 0) - bottomRightDisplayedHeight
    )

    return {
      spacing: { top, bottom, left, right },
      sceneSize: { width: sceneWidth, height: sceneHeight }
    }
  }

  async function setCameraSpacing(spacing = { top: 0, bottom: 0, left: 0, right: 0 }) {
    const moveFilters = await getMoveFilters("Camera")
    const currentId = await getCurrentFilterId("Camera", "Camera Source")
    const currentFilter = findCurrentFilter(moveFilters, currentId)

    const { sceneWidth, sceneHeight, sourceWidth, sourceHeight } = await getSceneAndSourceInfo()
    const { filters } = await obs.call("GetSourceFilterList", { sourceName: "Camera" })
    const corners = ["top-left", "top-right", "bottom-left", "bottom-right"]

    for (const filterName of corners) {
      const filterData = filters.find((f) => f.filterName === filterName)
      if (!filterData) {
        console.warn(`Filter not found: ${filterName}`)
        continue
      }

      const fs = filterData.filterSettings
      const displayedWidth =
        (sourceWidth - (fs.crop?.left ?? 0) - (fs.crop?.right ?? 0)) * (fs.scale?.x ?? 1)
      const displayedHeight =
        (sourceHeight - (fs.crop?.top ?? 0) - (fs.crop?.bottom ?? 0)) * (fs.scale?.y ?? 1)

      const x =
        filterName === "top-left" || filterName === "bottom-left"
          ? spacing.left
          : sceneWidth - displayedWidth - spacing.right

      const y =
        filterName === "top-left" || filterName === "top-right"
          ? spacing.top
          : sceneHeight - displayedHeight - spacing.bottom

      const newPos = { x, y }

      await obs.call("SetSourceFilterSettings", {
        sourceName: "Camera",
        filterName,
        filterSettings: { ...fs, pos: newPos },
        overlay: false
      })
    }

    if (currentFilter) {
      await obs.call("SetSourceFilterEnabled", {
        sourceName: "Camera",
        filterName: currentFilter.name,
        filterEnabled: true
      })
    }
  }

  async function getCameraCrop() {
    const { filters } = await obs.call("GetSourceFilterList", { sourceName: "Camera" })
    const fs = filters.find((f) => f.filterName === "top-left")?.filterSettings

    const crop = {
      left: fs?.crop?.left ?? 0,
      right: fs?.crop?.right ?? 0,
      top: fs?.crop?.top ?? 0,
      bottom: fs?.crop?.bottom ?? 0
    }

    const { sceneItems } = await obs.call("GetSceneItemList", { sceneName: "Camera" })
    const cameraSource = sceneItems.find((item) => item.sourceName === "Camera Source")
    const size = {
      width: cameraSource.sceneItemTransform.sourceWidth,
      height: cameraSource.sceneItemTransform.sourceHeight
    }

    return { size, crop }
  }

  async function setCameraCrop(crop = { left: 0, right: 0, top: 0, bottom: 0 }) {
    const moveFilters = await getMoveFilters("Camera")
    const currentId = await getCurrentFilterId("Camera", "Camera Source")
    const currentFilter = findCurrentFilter(moveFilters, currentId)

    const { filters } = await obs.call("GetSourceFilterList", { sourceName: "Camera" })
    const corners = ["top-left", "top-right", "bottom-left", "bottom-right"]

    for (const filterName of corners) {
      const filterData = filters.find((f) => f.filterName === filterName)
      if (!filterData) {
        console.warn(`Filter not found: ${filterName}`)
        continue
      }

      const fs = filterData.filterSettings

      const leftDelta = crop.left - (fs.crop?.left ?? 0)
      const rightDelta = crop.right - (fs.crop?.right ?? 0)
      const topDelta = crop.top - (fs.crop?.top ?? 0)
      const bottomDelta = crop.bottom - (fs.crop?.bottom ?? 0)

      const xDeltaScaled = (leftDelta + rightDelta) * (fs.scale?.x ?? 1)
      const yDeltaScaled = (topDelta + bottomDelta) * (fs.scale?.y ?? 1)

      const newPos = { ...(fs.pos ?? { x: 0, y: 0 }) }
      if (filterName === "top-right") {
        newPos.x += xDeltaScaled
      } else if (filterName === "bottom-left") {
        newPos.y += yDeltaScaled
      } else if (filterName === "bottom-right") {
        newPos.x += xDeltaScaled
        newPos.y += yDeltaScaled
      }

      await obs.call("SetSourceFilterSettings", {
        sourceName: "Camera",
        filterName,
        filterSettings: {
          ...fs,
          pos: newPos,
          crop: { top: crop.top, bottom: crop.bottom, left: crop.left, right: crop.right }
        },
        overlay: false
      })
    }

    if (currentFilter) {
      await obs.call("SetSourceFilterEnabled", {
        sourceName: "Camera",
        filterName: currentFilter.name,
        filterEnabled: true
      })
    }
  }

  return {
    connect,
    setMoveFilter,
    moveRelative,
    getCameraCrop,
    setCameraCrop,
    getCameraSpacing,
    setCameraSpacing
  }
}
