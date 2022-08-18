const fs = require('fs')

const ProgressBar = require('progress')
const mkdirp = require('mkdirp')
const rimraf = require('rimraf')
const tar = require('tar')
const http = require('https')
const https = require('https')
const { createHash } = require('crypto')

const config = require('./config')()

const verifyFile = function(file, callback) {
  const h = createHash('sha256').on('finish', () => {
    const hash = h.digest('hex')
    const match = hash === config.checksum
    if (!match) {
      console.log(`Validation failed. Expected '${config.checksum}' but got '${hash}'`)
    }
    callback(match)
  })

  fs.createReadStream(file, { autoClose: true }).pipe(h)
}

const unpackFile = function(file) {
  tar.x({ cwd: config.outputPath, file }).catch(e => {
    console.log('Unable to extract archive, aborting...', error)
    process.exit(1)
  })
}

const downloadAndUnpack = (url, redirect) => {
  if (!redirect) {
    console.log(`Downloading Git from: ${config.source}`)
  }

  const options = {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'dugite'
    },
    secureProtocol: 'TLSv1_2_method'
  }

  const client = url.startsWith('https:') ? https : config.startsWith('http:') ? http : null

  if (!client) {
    throw new Error(`Invalid protocol for ${config.source}`)
  }

  const req = client.get(url, options)

  req.on('error', function(error) {
    if (error.code === 'ETIMEDOUT') {
      console.log(
        `A timeout has occurred while downloading '${config.source}' - check ` +
          `your internet connection and try again. If you are using a proxy, ` +
          `make sure that the HTTP_PROXY and HTTPS_PROXY environment variables are set.`,
        error
      )
    } else {
      console.log(`Error raised while downloading ${config.source}`, error)
    }
    process.exit(1)
  })

  req.on('response', function(res) {
    if ([301, 302].includes(res.statusCode) && res.headers['location']) {
      downloadAndUnpack(res.headers.location, true)
      return
    }

    if (res.statusCode !== 200) {
      console.log(`Non-200 response returned from ${config.source} - (${res.statusCode})`)
      process.exit(1)
    }

    const len = parseInt(res.headers['content-length'], 10)

    console.log()
    const bar = new ProgressBar('Downloading Git [:bar] :percent :etas', {
      complete: '=',
      incomplete: ' ',
      width: 50,
      total: len
    })

    res.pipe(fs.createWriteStream(config.tempFile))

    res.on('data', function(chunk) {
      bar.tick(chunk.length)
    })

    res.on('end', function() {
      console.log('\n')

      verifyFile(config.tempFile, valid => {
        if (valid) {
          unpackFile(config.tempFile)
        } else {
          console.log(`checksum verification failed, refusing to unpack...`)
          process.exit(1)
        }
      })
    })
  })
}

if (config.source === '') {
  console.log(
    `Skipping downloading embedded Git as platform '${process.platform}' is not supported.`
  )
  console.log(`To learn more about using dugite with a system Git: https://git.io/vF5oj`)
  process.exit(0)
}

if (fs.existsSync(config.outputPath)) {
  try {
    rimraf.sync(config.outputPath)
  } catch (err) {
    console.error(err)
    return
  }
}

mkdirp(config.outputPath, function(error) {
  if (error) {
    console.log(`Unable to create directory at ${config.outputPath}`, error)
    process.exit(1)
  }

  const tempFile = config.tempFile

  if (fs.existsSync(tempFile)) {
    verifyFile(tempFile, valid => {
      if (valid) {
        unpackFile(tempFile)
      } else {
        rimraf.sync(tempFile)
        downloadAndUnpack(config.source)
      }
    })
    return
  }

  downloadAndUnpack(config.source)
})
