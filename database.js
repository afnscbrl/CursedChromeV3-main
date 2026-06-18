'use strict';

const { Sequelize, DataTypes, Model } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { get_secure_random_string, get_hashed_password } = require('./utils');

const sequelize = new Sequelize(
    process.env.DATABASE_NAME,
    process.env.DATABASE_USER,
    process.env.DATABASE_PASSWORD,
    {
        host:    process.env.DATABASE_HOST,
        dialect: 'postgres',
        logging: false,
    }
);

class Users extends Model {}
Users.init({
    id:       { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
    username: { type: DataTypes.TEXT, allowNull: false, unique: true },
    password: { type: DataTypes.TEXT, allowNull: false },
    password_should_be_changed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { sequelize, modelName: 'users' });

class Bots extends Model {}
Bots.init({
    id:             { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
    browser_id:     { type: DataTypes.TEXT, allowNull: false },
    name:           { type: DataTypes.TEXT, allowNull: false, defaultValue: 'Untitled Bot' },
    proxy_username: { type: DataTypes.TEXT, allowNull: false, unique: true },
    proxy_password: { type: DataTypes.TEXT, allowNull: false },
    is_online:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    user_agent:     { type: DataTypes.TEXT, allowNull: true },
}, { sequelize, modelName: 'bots' });

class Settings extends Model {}
Settings.init({
    id:    { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
    key:   { type: DataTypes.TEXT, allowNull: false, unique: true },
    value: { type: DataTypes.TEXT, allowNull: false },
}, { sequelize, modelName: 'settings' });

async function initialize_configs() {
    const exists = await Settings.findOne({ where: { key: 'SESSION_SECRET' } });
    if (exists) return;
    console.log('Generating session secret...');
    await Settings.create({ key: 'SESSION_SECRET', value: get_secure_random_string(64) });
}

async function initialize_users() {
    const count = await Users.count();
    if (count > 0) return;

    const username = 'admin';
    const password = get_secure_random_string(32);
    await Users.create({
        username,
        password: await get_hashed_password(password),
        password_should_be_changed: true,
    });

    console.log(`\n${'='.repeat(72)}`);
    console.log(' ATTENTION: Default admin account created');
    console.log(`\n  USERNAME: ${username}`);
    console.log(`  PASSWORD: ${password}`);
    console.log('\n  Change your password after first login.');
    console.log(`${'='.repeat(72)}\n`);
}

async function database_init() {
    await Users.sync();
    await Bots.sync();
    await Settings.sync();
    await initialize_configs();
    await initialize_users();
}

module.exports = { sequelize, Users, Bots, Settings, database_init };
