export interface HelmFile {
  path: string
  content: string
}

export interface HelmChartBundle {
  files: HelmFile[]
  chartName: string
  version?: string
  description?: string
}

function readTarString(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder().decode(bytes.slice(start, start + length)).replace(/\0+$/, '').trim()
}

function readOctal(bytes: Uint8Array, start: number, length: number): number {
  const value = readTarString(bytes, start, length)
  return value ? Number.parseInt(value, 8) || 0 : 0
}

function isZeroBlock(bytes: Uint8Array, offset: number): boolean {
  for (let index = 0; index < 512; index += 1) {
    if (bytes[offset + index] !== 0) return false
  }
  return true
}

async function gunzip(input: ArrayBuffer): Promise<Uint8Array> {
  if (!('DecompressionStream' in window)) {
    throw new Error('This browser does not support gzip decompression. Please use a modern browser.')
  }

  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function parseTar(bytes: Uint8Array): HelmFile[] {
  const files: HelmFile[] = []
  let offset = 0

  while (offset + 512 <= bytes.length) {
    if (isZeroBlock(bytes, offset)) break

    const name = readTarString(bytes, offset, 100)
    const size = readOctal(bytes, offset + 124, 12)
    const type = String.fromCharCode(bytes[offset + 156] || 0)
    const dataStart = offset + 512
    const dataEnd = dataStart + size

    if (name && type !== '5' && dataEnd <= bytes.length) {
      files.push({
        path: name,
        content: new TextDecoder().decode(bytes.slice(dataStart, dataEnd)),
      })
    }

    offset = dataStart + Math.ceil(size / 512) * 512
  }

  return files
}

export async function readHelmChart(file: File): Promise<HelmChartBundle> {
  const files = parseTar(await gunzip(await file.arrayBuffer()))
  const chartFile = files.find((entry) => /(^|\/)Chart\.yaml$/.test(entry.path))

  if (!chartFile) {
    throw new Error('The archive does not contain a Chart.yaml file.')
  }

  let chartName = file.name.replace(/\.tgz$/i, '')
  let version: string | undefined
  let description: string | undefined

  const nameMatch = chartFile.content.match(/^name:\s*([^\n#]+)/m)
  const versionMatch = chartFile.content.match(/^version:\s*([^\n#]+)/m)
  const descriptionMatch = chartFile.content.match(/^description:\s*([^\n#]+)/m)

  if (nameMatch?.[1]) chartName = nameMatch[1].trim().replace(/^['"]|['"]$/g, '')
  if (versionMatch?.[1]) version = versionMatch[1].trim().replace(/^['"]|['"]$/g, '')
  if (descriptionMatch?.[1]) description = descriptionMatch[1].trim().replace(/^['"]|['"]$/g, '')

  return { files, chartName, version, description }
}
