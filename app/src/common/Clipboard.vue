<template lang="pug">
  span(@click.stop='copy()', style='cursor: pointer')
    slot(:state='state')
      icon.fa-fw(name="fa-copy", v-if="state==='pristine'")
      icon.fa-fw(name="fa-check", v-if="state==='copied'")
      icon.fa-fw(name="fa-exclamation-triangle", v-if="state==='error'")
      slot(name='text')  {{ $root.lang.clipboard }}
</template>


<script>
  export default {
    name: "Clipboard",
    props: {
      value: {
        type: String,
        required: true
      }
    },
    data() {
      return {
        state: 'pristine' // copied, error
      };
    },
    methods: {
      copy() {
        let el = document.createElement('textarea');
        Object.assign(el.style, {
          position: 'absolute',
          left: '-200%'
        });
        el.value = this.value;
        document.body.appendChild(el);

        let success = false;
        try {
          el.select();
          success = document.execCommand('copy');
        }
        catch(e) {
          alert(this.$root.lang.oldBrowserError);
          console.error(e);
        }
        document.body.removeChild(el);
        this.state = success ? 'copied' : 'error';
        this.$emit('change', this.state);
      }
    }
  };
</script>
