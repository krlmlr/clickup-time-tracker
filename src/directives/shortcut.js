export default {
  mounted(el, binding) {
    const key = binding.arg;
    const handler = binding.value;
    const isMac = process.platform === 'darwin';

    const keydownListener = (event) => {
      const shouldTrigger = isMac ? event.metaKey : event.ctrlKey;

      if (!shouldTrigger || event.shiftKey || event.altKey) return;

      const eventKey = event.key === 'Delete' ? 'Delete' : event.key.toLowerCase();
      const targetKey = key === 'delete' ? 'Delete' : key.toLowerCase();

      if (eventKey === targetKey) {
        event.preventDefault();
        handler(event);
      }
    };

    el.addEventListener('keydown', keydownListener);
    el._shortcutListener = keydownListener;
  },

  unmounted(el) {
    if (el._shortcutListener) {
      el.removeEventListener('keydown', el._shortcutListener);
      delete el._shortcutListener;
    }
  }
};
