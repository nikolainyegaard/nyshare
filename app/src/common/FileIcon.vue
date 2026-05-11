<template lang="pug">
  div.file-icon
    icon(:name="iconName", v-if="!isImageBlob", scale="3")
    |
    img(v-if='isImageBlob', :src='blobUrl')
</template>


<script>
  export default {
    props: ['file'],

    computed: {
      iconName() {
        const type = this.file.type || this.file.metadata && this.file.metadata.type;
        if(!type) return 'fa-regular-file';
        if(type.startsWith('image')) return 'fa-regular-file-image';
        if(type.startsWith('text')) return 'fa-regular-file-alt';
        if(type.startsWith('video')) return 'fa-regular-file-video';
        if(type.startsWith('audio')) return 'fa-regular-file-audio';
        if(type === 'application/pdf') return 'fa-regular-file-pdf';
        if(type.startsWith('application')) return 'fa-regular-file-archive';
        return 'fa-regular-file';
      },
      isImageBlob() {
        return this.file instanceof File && this.file.type.startsWith('image');
      },
      blobUrl() {
        if(!this.isImageBlob) return;
        return URL.createObjectURL(this.file);
      }
    }
  };
</script>
