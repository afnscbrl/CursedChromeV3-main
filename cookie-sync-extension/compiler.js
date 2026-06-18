const compiler = require('vue-template-compiler')

template = `<div id="app">
        <div class="card">
            <div class="card-header">
                <span class="badge badge-secondary" v-if="loading">
                    <span class="spinner-border spinner-border-sm mr-1" role="status" aria-hidden="true"></span>Loading...
                </span>
                CursedChrome Cookie Sync Extension
            </div>
            <div class="card-body" style="min-width: 500px; padding: 20px">
                <div>
                    <h5 class="card-title">Extension Configuration</h5>
                    <div class="alert alert-danger" role="alert" v-if="config_message">
                        {{config_message}}
                    </div>
                    <div class="card-text">
                        <div class="input-group mb-3">
                            <div class="input-group-prepend">
                                <span class="input-group-text">Web Panel URL</span>
                            </div>
                            <input type="text" class="form-control" placeholder="http://localhost:8118" v-model="config.url" @keypress="check_login_credentials" @paste="check_login_credentials" v-on:change="check_login_credentials">
                        </div>
                        <div class="input-group mb-3">
                            <div class="input-group-prepend">
                                <span class="input-group-text">Bot Username</span>
                            </div>
                            <input type="text" class="form-control" placeholder="botuserxxxxxxxx" v-model="config.username" @keypress="check_login_credentials" @paste="check_login_credentials" v-on:change="check_login_credentials">
                        </div>
                        <div class="input-group mb-3">
                            <div class="input-group-prepend">
                                <span class="input-group-text">Bot Password</span>
                            </div>
                            <input type="password" class="form-control" placeholder="*********" v-model="config.password" @keypress="check_login_credentials" @paste="check_login_credentials" v-on:change="check_login_credentials">
                        </div>
                    </div>
                    <hr />
                    <span rel="tooltip" class="d-inline-block" style="width: 100%" tabindex="0" data-toggle="tooltip" title="Valid configuration required." v-if="config.sync_button_disabled">
                        <button type="button" style="pointer-events: none;" class="btn btn-block btn-primary" disabled>
                            <i class="fas fa-sync"></i> Sync Remote Implant Cookies
                        </button>
                    </span>
                    <button type="button" class="btn btn-block btn-primary" v-if="!config.sync_button_disabled" v-on:click="sync_cookies_to_browser">
                        <i class="fas fa-sync"></i> Sync Remote Implant Cookies
                    </button>
                </div>
            </div>
        </div>`

const compiled = compiler.compile(template);

console.log(compiled.render);
console.log(compiled.staticRenderFns);