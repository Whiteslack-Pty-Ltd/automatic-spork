var fs = require('fs')
var resolve = require('path').resolve

var cwd = process.cwd()
var mkdirp = require('mkdirp')
var rimraf = require('rimraf')
var test = require('tap').test

var npm = require('../../lib/npm.js')
var common = require('../common-tap.js')

var pkg = resolve(common.pkg, 'package')
var repos = resolve(common.pkg, 'repos')
var subwt = resolve(repos, 'subwt')
var topwt = resolve(repos, 'topwt')
var suburl = 'git://localhost:' + common.gitPort + '/sub.git'
var topurl = 'git://localhost:' + common.gitPort + '/top.git'

var daemon
var daemonPID
var git

var pjParent = JSON.stringify({
  name: 'parent',
  version: '1.2.3',
  dependencies: {
    child: topurl
  }
}, null, 2) + '\n'

var pjChild = JSON.stringify({
  name: 'child',
  version: '1.0.3'
}, null, 2) + '\n'

test('setup', function (t) {
  setup(function (er, r) {
    t.ifError(er, 'git started up successfully')
    t.end()
  })
})

test('install from repo', function (t) {
  bootstrap(t)
  npm.commands.install('.', [], function (er) {
    t.ifError(er, 'npm installed via git')
    t.end()
  })
})

test('has file in submodule', function (t) {
  bootstrap(t)
  npm.commands.install('.', [], function (er) {
    t.ifError(er, 'npm installed via git')
    var fooPath = resolve('node_modules', 'child', 'subpath', 'foo.txt')
    fs.stat(fooPath, function (er) {
      t.ifError(er, 'file in submodule exists')
      t.end()
    })
  })
})

test('clean', function (t) {
  daemon.on('close', function () {
    t.end()
  })
  process.kill(daemonPID)
})

function bootstrap (t) {
  process.chdir(cwd)
  rimraf.sync(pkg)
  mkdirp.sync(pkg)
  process.chdir(pkg)
  fs.writeFileSync('package.json', pjParent)
}

function setup (cb) {
  rimraf.sync(pkg)
  rimraf.sync(repos)

  mkdirp.sync(topwt)
  fs.writeFileSync(resolve(topwt, 'package.json'), pjChild)
  mkdirp.sync(subwt)
  fs.writeFileSync(resolve(subwt, 'foo.txt'), 'This is provided by submodule')
  npm.load({ registry: common.registry, loglevel: 'silent' }, function () {
    git = require('../../lib/utils/git.js')

    function startDaemon (cb) {
      // start git server
      var d = git.spawn(
        [
          'daemon',
          '--verbose',
          '--listen=localhost',
          '--export-all',
          '--base-path=.',
          '--reuseaddr',
          '--port=' + common.gitPort
        ],
        {
          cwd: repos,
          env: process.env,
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )
      d.stderr.on('data', childFinder)

      function childFinder (c) {
        var cpid = c.toString().match(/^\[(\d+)\]/)
        if (cpid[1]) {
          this.removeListener('data', childFinder)
          daemon = d
          daemonPID = cpid[1]
          cb(null)
        }
      }
    }

    var env = { PATH: process.env.PATH }
    var topopt = { cwd: topwt, env: env }
    var reposopt = { cwd: repos, env: env }
    common.makeGitRepo({
      path: subwt,
      message: 'subwt repo: ' + subwt,
      added: ['foo.txt'],
      commands: [
        git.chainableExec(['clone', '--bare', subwt, 'sub.git'], reposopt),
        startDaemon,
        [common.makeGitRepo, {
          path: topwt,
          message: 'topwt repo: ' + topwt,
          commands: [
            git.chainableExec(['submodule', 'add', suburl, 'subpath'], topopt),
            git.chainableExec(['commit', '-m', 'added submodule'], topopt),
            git.chainableExec(['clone', '--bare', topwt, 'top.git'], reposopt)
          ]
        }]
      ]
    }, cb)
  })
}
