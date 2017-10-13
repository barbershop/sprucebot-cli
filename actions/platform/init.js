const path = require('path')
const fs = require('fs-extra')
const config = require('config')
const chalk = require('chalk')
const childProcess = require('child_process')
const inquirer = require('inquirer')
const hostile = require('hostile')

const checkoutVersion = require('./version')

const { directoryExists, fileExists } = require('../../utils/dir')

async function prompt(options) {
	const prompts = []

	if (!options.installPath) {
		prompts.push({
			type: 'input',
			name: 'installPath',
			message: 'Install location (absolute path)',
			default: `${process.cwd()}/sprucebot`
		})
	}

	if (!options.gitUser) {
		prompts.push({
			type: 'input',
			name: 'gitUser',
			message: `Github username. (Developers should use their own. Othewise default is fine.)`,
			default: config.get('gitUser')
		})
	}

	const values = {
		...options,
		...(await inquirer.prompt(prompts))
	}
	if (!path.isAbsolute(values.installPath)) {
		throw new Error(
			`Woops, I can only install in an absolute installPath. You supplied ${values.installPath}`
		)
	}
	return values
}

async function writeRepos(installPath, gitUser) {
	console.log('writing repos...', installPath, gitUser)
	const gitBase = `git@github.com:${gitUser}`
	const pathDev = path.resolve(installPath, 'dev-services')
	const pathApi = path.resolve(installPath, 'api')
	const pathWeb = path.resolve(installPath, 'web')
	const pathRelay = path.resolve(installPath, 'sprucebot-relay')

	cloneRepo(
		`${gitBase}/${config.get('repositories.dev-services')}`,
		installPath
	)
	cloneRepo(`${gitBase}/${config.get('repositories.api')}`, pathApi)
	cloneRepo(`${gitBase}/${config.get('repositories.web')}`, pathWeb)
	cloneRepo(
		`${gitBase}/${config.get('repositories.sprucebot-relay')}`,
		pathRelay
	)

	yarnInstall(installPath)
	yarnInstall(pathApi)
	yarnInstall(pathWeb)
	yarnInstall(pathRelay)
}

async function cloneRepo(repo, localPath) {
	const exists = directoryExists(localPath)
	if (exists) {
		console.log(
			`Oh snap, looks like you already installed something at ${localPath}! Skipping for now.`
		)
	} else {
		// TODO - Make sure this halts when github public key is missing
		const cmd = childProcess.spawnSync('git', ['clone', repo, localPath], {
			stdio: 'inherit',
			env: process.env
		})

		if (cmd.status === 0) {
			console.log(chalk.green(`Finished cloning ${repo} to ${localPath}.`))
		} else {
			console.log(
				chalk.bold.red(`CRAP, looks like there was a problem cloning ${repo}.`)
			)
		}
	}
}

async function copyFile(fromFile, toFile) {
	try {
		fs.copySync(fromFile, toFile)
		console.log(chalk.green(`Successfully created ${toFile}`))
	} catch (e) {
		console.error(e)
		console.log(
			chalk.bold.red(
				`CRAP, I had trouble copying your ecosystem file ${fromFile}`
			)
		)
	}
}

async function yarnInstall(cwd) {
	childProcess.spawnSync('nvm', ['use'], {
		cwd,
		stdio: 'inherit',
		env: process.env
	})
	const cmd = childProcess.spawnSync('yarn', ['install', '--ignore-engines'], {
		cwd,
		stdio: 'inherit',
		env: process.env
	})

	if (cmd.status === 0) {
		console.log(chalk.green('Successfully installed project dependencies'), cwd)
	} else {
		console.log(
			chalk.bold.red(`Crap, I had trouble installing with yarn ${cwd}`)
		)
	}
}

async function writeEnvs(installPath) {
	const webEnvFrom = path.resolve(installPath, './web/.env.example')
	const webEnvTo = path.resolve(installPath, './web/.env')
	if (!fileExists(webEnvTo)) {
		await copyFile(webEnvFrom, webEnvTo)
	} else {
		console.warn(
			chalk.yellow(
				`Careful. An .env already exists in ${webEnvTo} Proceed with caution...`
			)
		)
	}

	const apiEnvFrom = path.resolve(installPath, './api/app/.env.example')
	const apiEnvTo = path.resolve(installPath, './api/app/.env')
	if (!fileExists(apiEnvTo)) {
		await copyFile(apiEnvFrom, apiEnvTo)
	} else {
		console.warn(
			chalk.yellow(
				`Careful. An .env already exists in ${apiEnvTo} Proceed with caution...`
			)
		)
	}

	const relayEnvFrom = path.resolve(
		installPath,
		'./sprucebot-relay/.env.sample'
	)
	const relayEnvTo = path.resolve(installPath, './sprucebot-relay/.env')
	if (!fileExists(relayEnvTo)) {
		await copyFile(relayEnvFrom, relayEnvTo)
	} else {
		console.warn(
			chalk.yellow(
				`Careful. An .env already exists in ${relayEnvTo} Proceed with caution...`
			)
		)
	}
}

const init = (module.exports = async function init(installPath, options = {}) {
	// TODO - Add --select-version option support
	const cliPath = path.resolve(__dirname, '..', '..')
	if (cliPath === process.cwd() && process.env.NODE_ENV !== 'test') {
		console.error(
			chalk.bold.red(
				'You cannot run `sprucebot platform init` from inside the sprucebot-cli directory.'
			)
		)
		throw new Error('Halting...')
	}

	const promptValues = await prompt({
		installPath,
		gitUser: options.gitUser
	})

	await writeRepos(promptValues.installPath, promptValues.gitUser)

	// Same as `sprucebot platform version` command
	if (options.selectVersion) {
		await checkoutVersion(promptValues.installPath, options)
	}

	const ecoFrom = path.resolve(
		promptValues.installPath,
		'./dev-services/ecosystem.config.js'
	)
	const ecoTo = path.resolve(promptValues.installPath, './ecosystem.config.js')
	await copyFile(ecoFrom, ecoTo)

	const packageFrom = path.resolve(
		promptValues.installPath,
		'./dev-services/package.json'
	)
	const packageTo = path.resolve(promptValues.installPath, './package.json')
	await copyFile(packageFrom, packageTo)

	await writeEnvs(promptValues.installPath)

	hostile.get(false, (err, lines) => {
		if (err) {
			console.error(
				chalk.bold.red(
					'Oh sh**, I had an issue reading your hosts file. Google `Sprucebot hosts file` for help.'
				)
			)
			throw new Error('Halting...')
		}

		const configured = lines.reduce((memo, line) => {
			if (/sprucebot/.test(line[1])) {
				memo[line[1]] = true
			}
			return memo
		}, {})

		// Help dev cd to correct directory
		let dir = path.basename(promptValues.installPath)

		if (
			!configured['local-api.sprucebot.com'] ||
			!configured['local.sprucebot.com'] ||
			!configured['local-devtools.sprucebot.com'] ||
			!configured['sprucebot_postgres'] ||
			!configured['sprucebot_redis']
		) {
			console.log(
				chalk.green(
					`Sweet! We're almost done! Last step is configuring your host file.`
				)
			)
			console.log(
				chalk.yellow(
					`Don't sweat it though, run \`cd ${dir} && sudo sprucebot platform configure\``
				)
			)
		} else {
			console.log(
				chalk.green('Heck yeah! I double checked and everything looks good.')
			)
			console.log(
				chalk.yellow(`Run \`cd ${dir} && sprucebot platform start\`  🌲 🤖`)
			)
		}
	})
})

init.spawnSync = childProcess.spawnSync
