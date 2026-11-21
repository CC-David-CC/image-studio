import {mount} from './app.mjs';
const app = mount({document});
document.querySelector('#studio').append(app.element);
window.addEventListener('pagehide', app.dispose, {once:true});
